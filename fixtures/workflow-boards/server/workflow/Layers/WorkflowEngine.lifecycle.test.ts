// @effect-diagnostics globalTimers:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { WorkflowEngine } from "../Services/WorkflowEngine.ts";
import { WorkflowEventStore } from "../Services/WorkflowEventStore.ts";
import { WorkflowReadModel, type TicketDetail } from "../Services/WorkflowReadModel.ts";
import { TestSql } from "../testHarness.ts";
import { WorkflowFoundationLive } from "../WorkflowFoundationLive.ts";
import { ApprovalGateLive } from "./ApprovalGate.ts";
import { BoardRegistryLive } from "./BoardRegistry.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { makeStubStepExecutor } from "./StubStepExecutor.ts";
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEngineLayer } from "./WorkflowEngine.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";
import { WorkflowRoutingContextBuilderLive } from "./WorkflowRoutingContextBuilder.ts";

const lifecycleDefinition = {
  name: "lifecycle",
  lanes: [
    { key: "triage", name: "Triage", entry: "manual" },
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      pipeline: [
        {
          key: "code",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "do it",
        },
      ],
      on: { success: "review", failure: "needs" },
    },
    {
      key: "review",
      name: "Review",
      entry: "manual",
      onEvent: [
        {
          name: "ci.passed",
          when: { "==": [{ var: "event.payload.status" }, "green"] },
          to: "done",
        },
      ],
    },
    { key: "needs", name: "Needs", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const scriptCancelNoop = Layer.succeed(ScriptCancelRegistry, {
  register: () => Effect.void,
  unregister: () => Effect.void,
  cancel: () => Effect.void,
});

const engineLayer = it.layer(
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(makeStubStepExecutor({ default: { _tag: "completed" } })),
    Layer.provideMerge(ApprovalGateLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(scriptCancelNoop),
    Layer.provideMerge(WorkflowRoutingContextBuilderLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(DeterministicWorkflowIds),
    Layer.provideMerge(TestSql),
  ),
);

const awaitLane = (ticketId: string, laneKey: string) =>
  Effect.gen(function* () {
    const read = yield* WorkflowReadModel;
    let detail: TicketDetail | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      detail = yield* read.getTicketDetail(ticketId as never);
      if (detail?.ticket.currentLaneKey === laneKey) {
        return detail;
      }
      yield* Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, 10)));
      yield* Effect.yieldNow;
    }
    return detail;
  });

engineLayer("WorkflowEngine lifecycle integration", (it) => {
  it.effect("threads create -> auto-run -> external-event route -> terminal", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      const engine = yield* WorkflowEngine;
      const read = yield* WorkflowReadModel;
      const store = yield* WorkflowEventStore;

      yield* registry.register("b-lifecycle" as never, lifecycleDefinition);

      const ticketId = yield* engine.createTicket({
        boardId: "b-lifecycle" as never,
        title: "Ship the thing",
        initialLane: "triage" as never,
      });
      assert.equal((yield* read.getTicketDetail(ticketId))?.ticket.currentLaneKey, "triage");

      yield* engine.moveTicket(ticketId, "impl" as never);
      const reviewDetail = yield* awaitLane(ticketId as string, "review");
      assert.equal(reviewDetail?.ticket.currentLaneKey, "review");
      assert.isTrue(
        reviewDetail?.steps.some((step) => step.stepKey === "code" && step.status === "completed"),
      );

      const moved = yield* engine.ingestExternalEvent({
        boardId: "b-lifecycle" as never,
        name: "ci.passed",
        ticketId,
        payload: { status: "green" },
      });
      assert.equal(moved.outcome, "moved");
      assert.equal(moved.toLane, "done");

      const doneDetail = yield* awaitLane(ticketId as string, "done");
      assert.equal(doneDetail?.ticket.currentLaneKey, "done");

      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "TicketRouteDecided" &&
            event.payload.source === "external_event" &&
            event.payload.toLane === "done",
        ),
      );
    }),
  );
});
