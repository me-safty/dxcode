/**
 * The Handle pattern (Epic 25 §The thread model) — the durable-suspension boundary the Thread
 * verbs are built on. A side-effect primitive splits into a `"sent"` entry (deterministic
 * `correlationId` of `"<runId>:<seq>"`, no result) and a `"resolved"` entry (keyed by that
 * `correlationId`, since the reply lands out of band). Two dispatch shapes share the machinery:
 *   • {@link HandleDispatch.send} — ask-shaped (`thread.turn` / `user.input`): journal the sent
 *     entry, fire the broker, return the `correlationId`; the body later `awaitResolution`s it.
 *   • {@link HandleDispatch.sendOneWay} — fire-and-forget (`thread.create` / `thread.message`):
 *     journal the sent entry SYNCHRONOUSLY (so seq alignment survives a later suspend), fire the
 *     broker best-effort, return the `correlationId` (the new thread's id). Never suspends.
 * Replay: a recorded sent entry is NOT re-fired; an ask whose resolved entry is present returns
 * the recorded reply, one whose entry is absent throws {@link WorkflowSuspended} (→ a
 * `SuspendedResult` the host resumes when the reply lands).
 */

import { hashArgs } from "./t3work-sdk.canonicalJson.ts";
import { CancelledError } from "./t3work-sdk.errors.ts";
import type { JournalEntry, ResolvedEntry } from "./t3work-sdk.journalReader.ts";
import type { JournalWriter } from "./t3work-sdk.journalWriter.ts";
import { assertJournalMatch, gapDrift } from "./t3work-sdk.replayDrift.ts";
import type { PrimitiveKind } from "./t3work-sdk.types.ts";

/** Settles a fired handle synchronously — the broker calls this when a reply is immediate. */
export interface ReplyResolver {
  resolve(reply: unknown): void;
  /** Terminal rejection — `.response` rejects and a later real reply is ignored. */
  reject(error?: unknown): void;
}

/** A handle "sent" call routed through the durable runtime's shared `seq` counter. */
export interface HandleSendCall {
  readonly kind: PrimitiveKind;
  readonly refId: string;
  /** Canonical-JSON args; hashed into the `sent` entry for drift detection. */
  readonly args: unknown;
  /** Fire the side effect (only on the live path). Receives the deterministic
   * `correlationId` and a resolver the broker may call to settle synchronously. */
  readonly fire: (correlationId: string, resolver: ReplyResolver) => Promise<void>;
}

/** The minimal seam the durable runtime exposes so handle journaling shares its `seq` seat. */
export interface HandleSeat {
  readonly runId: string;
  readonly filePath: string | undefined;
  readonly nowIso: () => string;
  readonly isBlackBoxed: () => boolean;
  /** Increment and return the shared `seq` counter (the position of the `sent` entry). */
  readonly takeSeq: () => number;
  readonly maxRecordedSeq: number;
  readonly recordedAt: (seq: number) => JournalEntry | undefined;
  readonly resolvedFor: (correlationId: string) => ResolvedEntry | undefined;
  readonly writer: JournalWriter;
  /** Update the in-memory resolved map so the same run sees a synchronous resolution. */
  readonly setResolved: (entry: ResolvedEntry) => void;
}

export interface HandleDispatch {
  /** Journal (or replay) an ask-shaped `sent` entry and fire the side effect; returns the
   * correlationId. */
  send(call: HandleSendCall): Promise<string>;
  /** Journal (or replay) a one-way `sent` entry synchronously and fire the side effect
   * best-effort; returns the correlationId (used as the new thread's id for `thread.create`). */
  sendOneWay(call: HandleSendCall): string;
  /** Read the resolved reply for a correlationId, or throw {@link WorkflowSuspended}. */
  awaitResolution<R>(
    correlationId: string,
    decodeReply: ((reply: unknown) => Promise<R>) | undefined,
  ): Promise<R>;
}

/**
 * The internal signal a suspended `await` on an ask-shaped reply throws. NOT part of the
 * author error taxonomy (it does not extend {@link import("./t3work-sdk.errors.ts").WorkflowError})
 * so a body's `catch (e instanceof WorkflowError)` does not swallow it; the runner catches it
 * by identity and parks the run.
 */
export class WorkflowSuspended extends Error {
  readonly correlationId: string;
  constructor(correlationId: string) {
    super(`Workflow suspended awaiting reply for correlationId '${correlationId}'.`);
    this.name = "WorkflowSuspended";
    this.correlationId = correlationId;
  }
}

const noopResolver: ReplyResolver = { resolve: () => {}, reject: () => {} };

export function createHandleDispatch(seat: HandleSeat): HandleDispatch {
  // Unique synthetic ids for black-boxed sends (inside parallel/pipeline). These execute live
  // and are never journaled/replayed, so the counter only has to stay unique within one run —
  // a shared `"<runId>:blackbox"` id would collide across concurrent thunks (first-write-wins
  // on the resolved map would hand one thunk another's reply).
  let blackboxSeq = 0;

  const recordResolved = (
    correlationId: string,
    kind: PrimitiveKind,
    refId: string,
    settle: { readonly reply?: unknown; readonly dismissed?: boolean },
  ): void => {
    if (seat.resolvedFor(correlationId) !== undefined) return; // first write wins
    const ts = seat.nowIso();
    seat.writer.appendResolved({ correlationId, kind, refId, ...settle, startedAt: ts, endedAt: ts });
    seat.setResolved({
      correlationId,
      kind,
      refId,
      dismissed: settle.dismissed ?? false,
      reply: settle.reply,
    });
  };

  const makeResolver = (correlationId: string, kind: PrimitiveKind, refId: string): ReplyResolver => ({
    resolve: (reply) => recordResolved(correlationId, kind, refId, { reply }),
    reject: () => recordResolved(correlationId, kind, refId, { dismissed: true }),
  });

  // A resolver for a black-boxed send: settles the IN-MEMORY map only, never the journal —
  // the enclosing parallel/pipeline entry is the journal boundary, so a nested ask's reply
  // must not occupy a journal line of its own.
  const inMemoryResolver = (correlationId: string, kind: PrimitiveKind, refId: string): ReplyResolver => ({
    resolve: (reply) => seat.setResolved({ correlationId, kind, refId, dismissed: false, reply }),
    reject: () => seat.setResolved({ correlationId, kind, refId, dismissed: true, reply: undefined }),
  });

  const send = async (call: HandleSendCall): Promise<string> => {
    if (seat.isBlackBoxed()) {
      const id = `${seat.runId}:blackbox:${(blackboxSeq += 1)}`;
      await call.fire(id, inMemoryResolver(id, call.kind, call.refId));
      return id;
    }
    const currentSeq = seat.takeSeq();
    const correlationId = `${seat.runId}:${currentSeq}`;
    const argsHash = hashArgs(call.args);
    const recorded = seat.recordedAt(currentSeq);
    if (recorded !== undefined) {
      assertJournalMatch(currentSeq, recorded, call.kind, call.refId, argsHash, seat.filePath);
      // Replay: the side effect already fired — do NOT re-fire the broker.
      return recorded.correlationId ?? correlationId;
    }
    if (currentSeq <= seat.maxRecordedSeq) gapDrift(currentSeq, call.kind, call.refId, seat.filePath);
    await call.fire(correlationId, makeResolver(correlationId, call.kind, call.refId));
    const ts = seat.nowIso();
    seat.writer.append({
      seq: currentSeq,
      callId: `${currentSeq}:${call.kind}:${call.refId}`,
      kind: call.kind,
      refId: call.refId,
      argsHash,
      result: undefined,
      phase: "sent",
      correlationId,
      startedAt: ts,
      endedAt: ts,
    });
    return correlationId;
  };

  const sendOneWay = (call: HandleSendCall): string => {
    if (seat.isBlackBoxed()) {
      const id = `${seat.runId}:blackbox:${(blackboxSeq += 1)}`;
      void call.fire(id, noopResolver);
      return id;
    }
    const currentSeq = seat.takeSeq();
    const correlationId = `${seat.runId}:${currentSeq}`;
    const argsHash = hashArgs(call.args);
    const recorded = seat.recordedAt(currentSeq);
    if (recorded !== undefined) {
      assertJournalMatch(currentSeq, recorded, call.kind, call.refId, argsHash, seat.filePath);
      return recorded.correlationId ?? correlationId; // replay: do NOT re-fire
    }
    if (currentSeq <= seat.maxRecordedSeq) gapDrift(currentSeq, call.kind, call.refId, seat.filePath);
    // Journal the sent entry SYNCHRONOUSLY (writeSync) before firing, so a suspend on a later
    // await cannot dispose the writer mid-append. Delivery is best-effort, fired floating.
    const ts = seat.nowIso();
    seat.writer.append({
      seq: currentSeq,
      callId: `${currentSeq}:${call.kind}:${call.refId}`,
      kind: call.kind,
      refId: call.refId,
      argsHash,
      result: undefined,
      phase: "sent",
      correlationId,
      startedAt: ts,
      endedAt: ts,
    });
    void call.fire(correlationId, noopResolver);
    return correlationId;
  };

  const awaitResolution = async <R>(
    correlationId: string,
    decodeReply: ((reply: unknown) => Promise<R>) | undefined,
  ): Promise<R> => {
    const resolved = seat.resolvedFor(correlationId);
    if (resolved === undefined) throw new WorkflowSuspended(correlationId);
    if (resolved.dismissed) {
      throw new CancelledError(
        `Handle '${correlationId}' was dismissed; its response will never settle.`,
      );
    }
    return (decodeReply === undefined ? resolved.reply : await decodeReply(resolved.reply)) as R;
  };

  return { send, sendOneWay, awaitResolution };
}
