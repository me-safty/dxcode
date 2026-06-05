/**
 * 25.3 primitive tests. Each primitive gets a round-trip (run → resume returns the recorded
 * result, the LLM/sleep/sub does NOT re-fire) and, where it journals, a drift check (tamper
 * the journal → loud ReplayDriftError). The budget accumulator and the wait-remainder resume
 * path get dedicated cases. All LLM calls go through a deterministic mock dispatcher.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentPrimitiveWorkflow,
  agentTaskWorkflow,
  budgetWorkflow,
  cleanupRunsRoot,
  counters,
  createMockLlmDispatcher,
  type MockLlmResponse,
  parallelWorkflow,
  pipelineWorkflow,
  resetCounters,
  runsRoot,
  subParentWorkflow,
  waitWorkflow,
} from "./t3work-sdk.engineFixtures.ts";
import { ReplayDriftError, resumeWorkflow, startWorkflow } from "./t3work-sdk.index.ts";
import { journalFilePath } from "./t3work-sdk.journal.ts";
import { readJournal } from "./t3work-sdk.journalReader.ts";

const responses = new Map<string, MockLlmResponse>([
  ["summarize cats", { text: "cats are fine", tokens: 5 }],
  ["classify cats", { structured: { sentiment: "positive" }, tokens: 7 }],
  ["plan launch", { structured: { steps: ["a", "b", "c"] }, tokens: 9 }],
  ["budget q1", { text: "x", tokens: 10 }],
  ["budget q2", { text: "y", tokens: 20 }],
  ["p1", { text: "r1", tokens: 1 }],
  ["p3", { text: "r3", tokens: 1 }],
  ["echo x", { text: "ex", tokens: 1 }],
  ["echo y", { text: "ey", tokens: 1 }],
  ["greet sub", { text: "hi sub", tokens: 3 }],
]);
const llm = createMockLlmDispatcher(responses);
const base = { runsRoot, tools: [], llm } as const;

/** Rewrite one journal line (matched by seq) via a mutator, preserving the rest. */
function patchJournalLine(
  file: string,
  seq: number,
  mutate: (entry: Record<string, unknown>) => void,
): void {
  const lines = readFileSync(file, "utf8").trim().split("\n");
  const index = lines.findIndex((line) => (JSON.parse(line) as { seq: number }).seq === seq);
  const entry = JSON.parse(lines[index] ?? "{}") as Record<string, unknown>;
  mutate(entry);
  lines[index] = JSON.stringify(entry);
  writeFileSync(file, `${lines.join("\n")}\n`);
}

beforeEach(resetCounters);
afterAll(cleanupRunsRoot);

describe("durable workflow engine — 25.3 primitives", () => {
  it("journals agent (text + schema) and replays both without re-invoking the LLM", async () => {
    const { runId, result } = await startWorkflow(agentPrimitiveWorkflow, { topic: "cats" }, base);
    expect(result).toEqual({ summary: "cats are fine", sentiment: "positive" });
    expect(counters.llmCalls).toBe(2);
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.size).toBe(2);
    expect(journal.get(1)).toMatchObject({ kind: "agent", refId: "agent" });
    expect(journal.get(2)).toMatchObject({ kind: "agent", refId: "agent" });
    const resumed = await resumeWorkflow(runId, agentPrimitiveWorkflow, { topic: "cats" }, base);
    expect(resumed.result).toEqual(result);
    expect(counters.llmCalls).toBe(2); // not re-invoked on replay
  });

  it("raises ReplayDriftError when a recorded agent argsHash no longer matches", async () => {
    const { runId } = await startWorkflow(agentPrimitiveWorkflow, { topic: "cats" }, base);
    patchJournalLine(journalFilePath(runsRoot, runId), 1, (e) => {
      e["argsHash"] = "f".repeat(64);
    });
    const error = await resumeWorkflow(
      runId,
      agentPrimitiveWorkflow,
      { topic: "cats" },
      base,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReplayDriftError);
    expect((error as ReplayDriftError).seq).toBe(1);
    expect((error as ReplayDriftError).reason).toBe("args");
  });

  it("journals a schema-typed agent.task and replays it", async () => {
    const { runId, result } = await startWorkflow(agentTaskWorkflow, { goal: "launch" }, base);
    expect(result).toEqual({ stepCount: 3 });
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.get(1)).toMatchObject({ kind: "agent.task", refId: "agent.task" });
    const resumed = await resumeWorkflow(runId, agentTaskWorkflow, { goal: "launch" }, base);
    expect(resumed.result).toEqual({ stepCount: 3 });
    expect(counters.llmCalls).toBe(1);
  });

  it("accumulates budget.spent() over agent tokens and replays the same readings", async () => {
    const opts = { ...base, budget: 100 };
    const { runId, result } = await startWorkflow(budgetWorkflow, {}, opts);
    expect(result).toEqual({ afterFirst: 10, afterSecond: 30, total: 100, remaining: 70 });
    const resumed = await resumeWorkflow(runId, budgetWorkflow, {}, opts);
    expect(resumed.result).toEqual(result); // accumulator rebuilds from the journal
    expect(counters.llmCalls).toBe(2); // both agent hits replayed, not re-invoked
  });

  it("black-boxes parallel thunks into one entry; failing thunk → null; no re-fire on resume", async () => {
    const { runId, result } = await startWorkflow(parallelWorkflow, {}, base);
    expect(result).toEqual({ results: ["r1", null, "r3"] });
    expect(counters.llmCalls).toBe(2); // p1 + p3; the throwing thunk never calls the LLM
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.size).toBe(1);
    expect(journal.get(1)).toMatchObject({ kind: "parallel", refId: "parallel" });
    const resumed = await resumeWorkflow(runId, parallelWorkflow, {}, base);
    expect(resumed.result).toEqual(result);
    expect(counters.llmCalls).toBe(2);
  });

  it("black-boxes a two-stage pipeline into one entry and replays it", async () => {
    const { runId, result } = await startWorkflow(pipelineWorkflow, { labels: ["x", "y"] }, base);
    expect(result).toEqual({ out: ["ex!", "ey!"] });
    expect(counters.llmCalls).toBe(2);
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.size).toBe(1);
    expect(journal.get(1)).toMatchObject({ kind: "pipeline", refId: "pipeline" });
    const resumed = await resumeWorkflow(runId, pipelineWorkflow, { labels: ["x", "y"] }, base);
    expect(resumed.result).toEqual(result);
    expect(counters.llmCalls).toBe(2);
  });

  it("runs a sub-workflow as one entry; the child does not re-execute on resume", async () => {
    const { runId, result } = await startWorkflow(subParentWorkflow, { name: "sub" }, base);
    expect(result).toEqual({ greeting: "hi sub", upper: "HI SUB" });
    expect(counters.llmCalls).toBe(1); // the child's agent call ran once, black-boxed
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.size).toBe(1);
    expect(journal.get(1)).toMatchObject({ kind: "workflow", refId: "workflow" });
    const resumed = await resumeWorkflow(runId, subParentWorkflow, { name: "sub" }, base);
    expect(resumed.result).toEqual(result);
    expect(counters.llmCalls).toBe(1); // child not re-run
  });

  it("wait records a deadline, sleeps once on the original run, and replays instantly", async () => {
    const ms = 60;
    const t0 = Date.now();
    const { runId, result } = await startWorkflow(waitWorkflow, { ms }, base);
    expect(result).toEqual({ done: true });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(ms - 20); // slept ~ms on the live run
    const journal = readJournal(journalFilePath(runsRoot, runId));
    expect(journal.get(1)).toMatchObject({ kind: "wait", refId: "wait" });
    const waitResult = journal.get(1)?.result as { deadline?: unknown } | undefined;
    expect(typeof waitResult?.deadline).toBe("number");
    const t1 = Date.now();
    const resumed = await resumeWorkflow(runId, waitWorkflow, { ms }, base);
    expect(resumed.result).toEqual({ done: true });
    expect(Date.now() - t1).toBeLessThan(ms); // deadline already passed → no sleep
  });

  it("wait sleeps the remainder on resume when the deadline has not yet passed", async () => {
    const { runId } = await startWorkflow(waitWorkflow, { ms: 20 }, base);
    const future = Date.now() + 250;
    patchJournalLine(journalFilePath(runsRoot, runId), 1, (e) => {
      e["result"] = { v: { deadline: future } };
    });
    const t0 = Date.now();
    await resumeWorkflow(runId, waitWorkflow, { ms: 20 }, base);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200); // slept the remaining ~250ms
  });

  it("raises ReplayDriftError when a recorded wait argsHash no longer matches", async () => {
    const { runId } = await startWorkflow(waitWorkflow, { ms: 10 }, base);
    patchJournalLine(journalFilePath(runsRoot, runId), 1, (e) => {
      e["argsHash"] = "f".repeat(64);
    });
    const error = await resumeWorkflow(runId, waitWorkflow, { ms: 10 }, base).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ReplayDriftError);
    expect((error as ReplayDriftError).seq).toBe(1);
  });
});
