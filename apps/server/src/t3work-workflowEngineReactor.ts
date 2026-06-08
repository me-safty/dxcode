/**
 * The workflow-engine resume reactor (Epic 25 §Host wiring) — the one genuinely new
 * production mechanism. It watches orchestration domain events and turns a completed agent
 * turn / a user reply into `appendResolvedEntry` + `resumeWorkflow`, driving a parked run
 * forward.
 *
 * For each `thread.message-sent` event it reads the pending ask the workflow registered for
 * that thread:
 *   • a final assistant message (`role: "assistant"`, not streaming) resolves a `thread.turn`
 *     (an `askAgent` / `agent` call) with the assistant text;
 *   • a user message resolves a `user.input` (an `askUser` call) with the user's text.
 * A message that does not match the pending ask's kind (e.g. the user-role prompt the engine
 * itself dispatched to start a turn) is left pending so the right event still resolves it.
 *
 * Events are drained through a single worker so resumes never interleave: `resume` awaits the
 * replay to its next suspension (which re-registers the new pending ask) before the next event
 * is processed.
 */

import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { T3workWorkflowEngineRegistry } from "./t3work-workflowEngineRegistry.ts";

type ThreadMessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

export const T3workWorkflowEngineReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestration = yield* OrchestrationEngineService;
    const registry = yield* T3workWorkflowEngineRegistry;

    const processMessageSent = Effect.fn("processWorkflowEngineMessageSent")(function* (
      event: ThreadMessageSentEvent,
    ) {
      const { threadId, role, streaming, text } = event.payload;
      if (streaming || (role !== "assistant" && role !== "user")) return;

      const pending = registry.takePending(threadId);
      if (pending === undefined) return;

      const expected = role === "assistant" ? "thread.turn" : "user.input";
      if (pending.kind !== expected) {
        // Not the event this ask awaits (e.g. the engine's own dispatched user prompt that
        // starts a turn) — re-register so the correct event can resolve it.
        registry.setPending(threadId, pending);
        return;
      }

      const run = registry.getRun(pending.runId);
      if (run === undefined) return;
      yield* Effect.promise(() => run.resume(pending.correlationId, text));
    });

    const processSafely = (event: ThreadMessageSentEvent) =>
      processMessageSent(event).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          return Effect.logWarning("t3work workflow-engine reactor failed to process event", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processSafely);

    yield* Effect.forkScoped(
      Stream.runForEach(orchestration.streamDomainEvents, (event) =>
        event.type === "thread.message-sent" ? worker.enqueue(event) : Effect.void,
      ),
    );
  }),
);
