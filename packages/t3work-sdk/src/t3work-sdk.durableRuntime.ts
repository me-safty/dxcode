/**
 * The durable runtime — a {@link T.WorkflowRuntime} backed by a per-run journal.
 *
 * Every primitive call lands on a monotonically-increasing `seq`, matched against the
 * journal on replay. Two seats share that counter and journal: the async `callPrimitive`
 * (tools/scripts/agent/wait/composition) and the synchronous `callDeterministic`
 * (now/random/uuid). Both decide between:
 *   • Hit + match     → return the recorded result (re-validated against the current
 *                       schema), do not re-execute. A matched `script-never` marker
 *                       re-executes (its result was never recorded).
 *   • Hit + mismatch  → throw {@link ReplayDriftError} (call-identity or argsHash).
 *   • Gap (seq ≤ max recorded, no entry) → `ReplayDriftError` (`presence: "gap"`).
 *   • Miss (past the frontier) → execute live, append a journal entry, return.
 *
 * Two black-box mechanisms skip the journal: a tool/script *handler* runs under the
 * `blackBox` runtime (a ref it calls re-entrantly doesn't journal), and
 * `parallel`/`pipeline`/`workflow` run their thunks inside {@link runBlackBoxed}, which
 * lifts a depth counter so nested primitive calls execute live without consuming a `seq`.
 * The composition primitive itself is the journal boundary — its inner calls are not
 * individually replayable (a documented Stage-1 tradeoff).
 */

import { canonicalJsonError, hashArgs } from "./t3work-sdk.canonicalJson.ts";
import { JournalSchemaError, JournalSerializeError } from "./t3work-sdk.errors.ts";
import type { JournalEntry } from "./t3work-sdk.journalReader.ts";
import type { JournalWriter } from "./t3work-sdk.journalWriter.ts";
import { assertJournalMatch, gapDrift } from "./t3work-sdk.replayDrift.ts";
import { createToolScriptCalls } from "./t3work-sdk.toolScriptCalls.ts";
import type * as T from "./t3work-sdk.types.ts";
import { hostSource } from "./t3work-sdk.workflowGlobals.ts";

/** Options for the durable runtime config. */
export interface DurableRuntimeConfig {
  readonly journal: ReadonlyMap<number, JournalEntry>;
  readonly writer: JournalWriter;
  readonly toolCtx: T.ToolHandlerCtx;
  readonly scriptCtx: T.ScriptHandlerCtx;
  readonly scriptNames: ReadonlyMap<T.AnyScriptRef, string>;
  /** Absolute path of the `.workflow.ts`, threaded into drift errors. */
  readonly filePath?: string;
  /** Host clock for journal timestamps (injected so workflowRunner can share it). */
  readonly nowIso: () => string;
}

/** A {@link T.WorkflowRuntime} backed by a per-run journal with replay + drift detection. */
export interface DurableWorkflowRuntime extends T.WorkflowRuntime {
  /** The last `seq` assigned (i.e. the count of primitive calls dispatched so far). */
  readonly currentSeq: () => number;
  /** Run `fn` with the black-box depth lifted — its primitive calls execute live and are
   * not journaled. Backs `parallel`/`pipeline`/`workflow`. */
  readonly runBlackBoxed: <R>(fn: () => Promise<R>) => Promise<R>;
  /** Sum of `tokens` over the `agent`/`agent.task` entries journaled so far — backs `budget`. */
  readonly spentAgentTokens: () => number;
  /** Real host wall-clock (unjournaled) — backs `wait`'s deadline math. */
  readonly hostNow: () => number;
}

/**
 * Construct a durable runtime over an already-loaded journal. Public so a host can drive
 * replay directly; {@link startWorkflow} / {@link resumeWorkflow} are the usual entry points.
 */
export function createDurableWorkflowRuntime(config: DurableRuntimeConfig): DurableWorkflowRuntime {
  let seq = 0;
  let blackBoxDepth = 0;
  // The recorded frontier. A call at `seq <= maxRecordedSeq` with no journal entry is a
  // *gap* — drift, not a live execution. Calls past it run live.
  const maxRecordedSeq =
    config.journal.size === 0 ? 0 : Math.max(...Array.from(config.journal.keys()));

  // Real host wall-clock/entropy — journaled by the live path, returned raw by the black box.
  const host = hostSource();

  // Budget accumulator: summed as `agent`/`agent.task` entries are replayed or journaled, so
  // it rebuilds identically on resume. Black-boxed agent calls never reach a record site.
  let spentAgentTokens = 0;
  const recordAgentTokens = (kind: T.PrimitiveKind, result: unknown): void => {
    if (kind !== "agent" && kind !== "agent.task") return;
    const tokens = (result as { readonly tokens?: unknown } | null)?.tokens;
    if (typeof tokens === "number") spentAgentTokens += tokens;
  };

  // Handlers are black boxes — a tool/script that calls another tool must NOT journal.
  const blackBox: T.WorkflowRuntime = {
    callTool: (ref, args) => toolScript.callTool(ref, args),
    callScript: (ref, args) => toolScript.callScript(ref, args),
    callPrimitive: (call) => call.exec(),
    now: host.now,
    random: host.random,
    uuid: host.uuid,
  };

  const runBlackBoxed = async <R>(fn: () => Promise<R>): Promise<R> => {
    blackBoxDepth += 1;
    try {
      return await fn();
    } finally {
      blackBoxDepth -= 1;
    }
  };

  const decodeRecorded = async <R>(
    call: T.PrimitiveCall<R>,
    recorded: unknown,
    atSeq: number,
  ): Promise<R> => {
    if (call.decodeRecorded === undefined) return recorded as R;
    try {
      return await call.decodeRecorded(recorded);
    } catch (error) {
      throw new JournalSchemaError({
        seq: atSeq,
        kind: call.kind,
        refId: call.refId,
        cause: error,
      });
    }
  };

  const callPrimitive = async <R>(call: T.PrimitiveCall<R>): Promise<R> => {
    if (blackBoxDepth > 0) return await call.exec();
    seq += 1;
    const currentSeq = seq;
    const argsHash = hashArgs(call.args);
    const isNever = call.replay === "never";
    const recorded = config.journal.get(currentSeq);

    if (recorded !== undefined) {
      assertJournalMatch(currentSeq, recorded, call.kind, call.refId, argsHash, config.filePath);
      // A matched `script-never` marker always re-runs (its result was never recorded).
      if (isNever) return await call.exec();
      recordAgentTokens(call.kind, recorded.result);
      return await decodeRecorded(call, recorded.result, currentSeq);
    }

    if (currentSeq <= maxRecordedSeq) gapDrift(currentSeq, call.kind, call.refId, config.filePath);

    // Past the recorded frontier → execute live and journal.
    const result = await call.exec();
    const startedAt = config.nowIso();
    const endedAt = config.nowIso();
    const callId = `${currentSeq}:${call.kind}:${call.refId}`;
    const baseEntry = { seq: currentSeq, callId, refId: call.refId, argsHash, startedAt, endedAt };

    if (isNever) {
      // Typed marker: occupy the seq, record no result (the script always re-runs).
      config.writer.append({ ...baseEntry, kind: "script-never", result: undefined });
      return result;
    }

    // Validate the result is canonical-JSON-encodable BEFORE writing. A `undefined`/void
    // result is journaled as the void envelope, so it is always encodable.
    const serializeError = result === undefined ? undefined : canonicalJsonError(result);
    if (serializeError !== undefined) {
      throw new JournalSerializeError({
        seq: currentSeq,
        kind: call.kind,
        refId: call.refId,
        cause: serializeError,
      });
    }
    config.writer.append({ ...baseEntry, kind: call.kind, result });
    recordAgentTokens(call.kind, result);
    return result;
  };

  // Synchronous journaled dispatch for the wall-clock/entropy primitives. Date.now(),
  // Math.random(), and crypto.randomUUID() are synchronous in JS, so they can't ride the
  // async `callPrimitive` seat; they share its seq counter, journal, and drift rules but run
  // inline. The recorded value (a number or string) replays verbatim — no schema decode.
  const callDeterministic = <R extends number | string>(
    kind: "now" | "random" | "uuid",
    exec: () => R,
  ): R => {
    if (blackBoxDepth > 0) return exec();
    seq += 1;
    const at = seq;
    const argsHash = hashArgs(null);
    const recorded = config.journal.get(at);
    if (recorded !== undefined) {
      assertJournalMatch(at, recorded, kind, kind, argsHash, config.filePath);
      return recorded.result as R;
    }
    if (at <= maxRecordedSeq) gapDrift(at, kind, kind, config.filePath);
    const result = exec();
    const ts = config.nowIso();
    config.writer.append({
      seq: at, callId: `${at}:${kind}:${kind}`, kind, refId: kind, argsHash, result, startedAt: ts, endedAt: ts,
    });
    return result;
  };

  const now = (): number => callDeterministic("now", host.now);
  const random = (): number => callDeterministic("random", host.random);
  const uuid = (): string => callDeterministic("uuid", host.uuid);

  const toolScript = createToolScriptCalls({
    callPrimitive,
    blackBox,
    toolCtx: config.toolCtx,
    scriptCtx: config.scriptCtx,
    scriptNames: config.scriptNames,
  });

  return {
    callTool: toolScript.callTool, callScript: toolScript.callScript, callPrimitive,
    now, random, uuid, currentSeq: () => seq, runBlackBoxed,
    spentAgentTokens: () => spentAgentTokens, hostNow: host.now,
  };
}
