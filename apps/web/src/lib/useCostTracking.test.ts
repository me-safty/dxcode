import { describe, expect, it } from "vitest";
import { EventId, type ModelSelection, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { processActivitiesForCost } from "./useCostTracking";

function makeContextWindowActivity(
  id: string,
  payload: Record<string, unknown>,
  createdAt = "2026-04-21T10:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

const sonnet: ModelSelection = {
  provider: "claudeAgent",
  model: "claude-sonnet-4-6",
};

describe("processActivitiesForCost", () => {
  it("returns empty records with null threadId", () => {
    const result = processActivitiesForCost(null, [], sonnet, null);
    expect(result.records).toEqual([]);
    expect(result.nextSeen.size).toBe(0);
  });

  it("seeds existing activities without recording on first mount", () => {
    const acts = [
      makeContextWindowActivity("evt-a", { lastOutputTokens: 1000 }),
      makeContextWindowActivity("evt-b", { lastOutputTokens: 500 }),
    ];
    const result = processActivitiesForCost("t1", acts, sonnet, null);
    expect(result.records).toEqual([]);
    expect(result.nextSeen.size).toBe(2);
  });

  it("records only new activities on subsequent call", () => {
    const seed = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-a", { lastOutputTokens: 100 })],
      sonnet,
      null,
    );
    const next = processActivitiesForCost(
      "t1",
      [
        makeContextWindowActivity("evt-a", { lastOutputTokens: 100 }),
        makeContextWindowActivity("evt-b", {
          lastInputTokens: 1_000,
          lastCachedInputTokens: 500,
          lastOutputTokens: 200,
        }),
      ],
      sonnet,
      seed.nextSeen,
    );
    expect(next.records).toHaveLength(1);
    const record = next.records[0]!;
    expect(record.threadId).toBe("t1");
    expect(record.model).toBe("claude-sonnet-4-6");
    expect(record.deltas.inputTokens).toBe(1_000);
    expect(record.deltas.outputTokens).toBe(200);
    // 1000*3 + 500*0.3 + 200*15 = 3000+150+3000 = 6150 / 1M = $0.00615
    expect(record.breakdown.totalUsd).toBeCloseTo(0.00615, 6);
  });

  it("skips events without per-turn deltas", () => {
    const seed = processActivitiesForCost("t1", [], sonnet, null);
    const next = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-1", { usedTokens: 10_000 })],
      sonnet,
      seed.nextSeen,
    );
    expect(next.records).toEqual([]);
    expect(next.nextSeen.has("evt-1")).toBe(true);
  });

  it("skips non-context-window activity kinds", () => {
    const seed = processActivitiesForCost("t1", [], sonnet, null);
    const other: OrchestrationThreadActivity = {
      id: EventId.make("evt-tool"),
      tone: "info",
      kind: "tool.started",
      summary: "tool.started",
      payload: { lastOutputTokens: 1_000 },
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-04-21T10:00:00.000Z",
    };
    const next = processActivitiesForCost("t1", [other], sonnet, seed.nextSeen);
    expect(next.records).toEqual([]);
    expect(next.nextSeen.has("evt-tool")).toBe(true);
  });

  it("skips when model selection missing", () => {
    const seed = processActivitiesForCost("t1", [], null, null);
    const next = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-1", { lastOutputTokens: 1_000 })],
      null,
      seed.nextSeen,
    );
    expect(next.records).toEqual([]);
  });

  it("skips when pricing resolves to zero (unknown model)", () => {
    const seed = processActivitiesForCost("t1", [], sonnet, null);
    const next = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-1", { lastOutputTokens: 1_000 })],
      { provider: "opencode", model: "some/unknown-model" },
      seed.nextSeen,
    );
    expect(next.records).toEqual([]);
    expect(next.nextSeen.has("evt-1")).toBe(true);
  });

  it("deduplicates by activity id", () => {
    const seed = processActivitiesForCost("t1", [], sonnet, null);
    const firstPass = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-1", { lastOutputTokens: 1_000 })],
      sonnet,
      seed.nextSeen,
    );
    expect(firstPass.records).toHaveLength(1);
    const secondPass = processActivitiesForCost(
      "t1",
      [makeContextWindowActivity("evt-1", { lastOutputTokens: 1_000 })],
      sonnet,
      firstPass.nextSeen,
    );
    expect(secondPass.records).toEqual([]);
  });

  it("uses activity.createdAt as `at` timestamp", () => {
    const seed = processActivitiesForCost("t1", [], sonnet, null);
    const next = processActivitiesForCost(
      "t1",
      [
        makeContextWindowActivity(
          "evt-1",
          { lastOutputTokens: 1_000 },
          "2026-03-15T00:00:00.000Z",
        ),
      ],
      sonnet,
      seed.nextSeen,
    );
    const record = next.records[0]!;
    expect(record.at?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});
