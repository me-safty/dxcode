// @effect-diagnostics globalTimers:off
import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { StepExecutor, type StepExecutorShape } from "../Services/StepExecutor.ts";
import { WorkflowEngine } from "../Services/WorkflowEngine.ts";
import { WorkflowEventCommitter } from "../Services/WorkflowEventCommitter.ts";
import { WorkflowEventStore } from "../Services/WorkflowEventStore.ts";
import { WorkflowReadModel, type TicketDetail } from "../Services/WorkflowReadModel.ts";
import { TestSql } from "../testHarness.ts";
import {
  makeWorkflowAgentPortFake,
  type WorkflowAgentPortFake,
} from "../WorkflowAgentPort.fake.ts";
import { WorkflowFoundationLive } from "../WorkflowFoundationLive.ts";
import { ApprovalGateLive } from "./ApprovalGate.ts";
import { BoardRegistryLive } from "./BoardRegistry.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { WorkflowAgentPortLive } from "./WorkflowAgentPort.ts";
import { makeStubStepExecutor } from "./StubStepExecutor.ts";
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEngineLayer } from "./WorkflowEngine.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";
import { WorkflowRoutingContextBuilderLive } from "./WorkflowRoutingContextBuilder.ts";

const definition = {
  name: "wf",
  lanes: [
    { key: "backlog", name: "Backlog", entry: "manual" },
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
      on: { success: "done", failure: "needs" },
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

const workflowAgentPortLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowAgentPortLive.pipe(Layer.provideMerge(fake.layer), Layer.provideMerge(TestSql));

const baseLayer = (executor: Layer.Layer<StepExecutor>) =>
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(executor),
    Layer.provideMerge(ApprovalGateLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(scriptCancelNoop),
    Layer.provideMerge(WorkflowRoutingContextBuilderLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(DeterministicWorkflowIds),
    Layer.provideMerge(TestSql),
  );

const baseLayerWithAgentPort = (executor: Layer.Layer<StepExecutor>, fake: WorkflowAgentPortFake) =>
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(executor),
    Layer.provideMerge(ApprovalGateLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(scriptCancelNoop),
    Layer.provideMerge(WorkflowRoutingContextBuilderLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(workflowAgentPortLayer(fake)),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(DeterministicWorkflowIds),
    Layer.provideMerge(TestSql),
  );

const awaitTicketWhere = (ticketId: string, predicate: (detail: TicketDetail | null) => boolean) =>
  Effect.gen(function* () {
    const read = yield* WorkflowReadModel;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = yield* read.getTicketDetail(ticketId as never);
      if (predicate(detail)) {
        return detail;
      }
      yield* Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, 10)));
      yield* Effect.yieldNow;
    }
    return yield* read.getTicketDetail(ticketId as never);
  });

const awaitLane = (ticketId: string, laneKey: string) =>
  awaitTicketWhere(ticketId, (detail) => detail?.ticket.currentLaneKey === laneKey);

const awaitStatus = (ticketId: string, status: string) =>
  awaitTicketWhere(ticketId, (detail) => detail?.ticket.status === status);

const successLayer = it.layer(baseLayer(makeStubStepExecutor({ default: { _tag: "completed" } })));

successLayer("WorkflowEngine integration", (it) => {
  it.effect("auto lane runs the pipeline and routes to done", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-1" as never, definition);
      const engine = yield* WorkflowEngine;

      const ticketId = yield* engine.createTicket({
        boardId: "b-1" as never,
        title: "Export",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitLane(ticketId as string, "done");
      assert.equal(detail?.ticket.currentLaneKey, "done");
      assert.isTrue(detail?.steps.some((step) => step.status === "completed"));
    }),
  );

  it.effect("edits ticket title and description metadata", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-edit" as never, definition);
      const engine = yield* WorkflowEngine;
      const read = yield* WorkflowReadModel;

      const ticketId = yield* engine.createTicket({
        boardId: "b-edit" as never,
        title: "Original title",
        description: "Original description",
        initialLane: "backlog" as never,
      });

      yield* engine.editTicket({
        ticketId,
        title: "  Updated title  ",
        description: "",
      });

      const detail = yield* read.getTicketDetail(ticketId);
      assert.equal(detail?.ticket.title, "Updated title");
      assert.equal(detail?.ticket.description, "");
    }),
  );

  it.effect("moveTicket fails for an unknown ticket instead of silently succeeding", () =>
    Effect.gen(function* () {
      const engine = yield* WorkflowEngine;
      const exit = yield* engine
        .moveTicket("ticket-does-not-exist" as never, "needs" as never)
        .pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      assert.instanceOf(error, WorkflowEventStoreError);
      assert.match((error as WorkflowEventStoreError).message, /ticket-does-not-exist not found/);
    }),
  );
});

const failLayer = it.layer(
  baseLayer(makeStubStepExecutor({ default: { _tag: "failed", error: "boom" } })),
);

failLayer("WorkflowEngine integration failure path", (it) => {
  it.effect("failed step routes to the failure lane", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-fail" as never, definition);
      const engine = yield* WorkflowEngine;

      const ticketId = yield* engine.createTicket({
        boardId: "b-fail" as never,
        title: "Fix",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitLane(ticketId as string, "needs");
      assert.equal(detail?.ticket.currentLaneKey, "needs");
      assert.isTrue(detail?.steps.some((step) => step.status === "failed"));
    }),
  );
});

const blockedDefinition = {
  name: "blocked-wf",
  lanes: [
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
      on: { success: "done", failure: "needs", blocked: "trust" },
    },
    { key: "needs", name: "Needs", entry: "manual" },
    { key: "trust", name: "Trust", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const blockedLayer = it.layer(
  baseLayer(
    makeStubStepExecutor({
      default: { _tag: "blocked", reason: "Project not trusted to run scripts" },
    }),
  ),
);

blockedLayer("WorkflowEngine integration blocked path", (it) => {
  it.effect("blocked step routes through the lane blocked target and records its reason", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-blocked" as never, blockedDefinition);
      const engine = yield* WorkflowEngine;
      const store = yield* WorkflowEventStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-blocked" as never,
        title: "Trust",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitLane(ticketId as string, "trust");
      assert.equal(detail?.ticket.currentLaneKey, "trust");
      assert.equal(detail?.steps[0]?.status, "blocked");
      assert.equal(detail?.steps[0]?.blockedReason, "Project not trusted to run scripts");

      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "StepBlocked" &&
            event.payload.reason === "Project not trusted to run scripts",
        ),
      );
      assert.isTrue(
        events.some(
          (event) => event.type === "PipelineCompleted" && event.payload.result === "blocked",
        ),
      );
    }),
  );
});

const explodingExecutor = Layer.succeed(StepExecutor, {
  execute: () =>
    Effect.fail(new WorkflowEventStoreError({ message: "executor exploded" })) as never,
} satisfies StepExecutorShape);

const explodingLayer = it.layer(baseLayer(explodingExecutor));

explodingLayer("WorkflowEngine pipeline error handling", (it) => {
  it.effect("records a failed step and routes when the executor effect fails", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-explodes" as never, definition);
      const engine = yield* WorkflowEngine;

      const ticketId = yield* engine.createTicket({
        boardId: "b-explodes" as never,
        title: "Explode",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitLane(ticketId as string, "needs");
      assert.equal(detail?.ticket.currentLaneKey, "needs");
      assert.equal(detail?.steps[0]?.status, "failed");
    }),
  );
});

const stepOnDefinition = {
  name: "step-on-wf",
  lanes: [
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      pipeline: [
        {
          key: "first",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "first",
          on: { success: "needs" },
        },
        {
          key: "second",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "second",
        },
      ],
      on: { success: "done" },
    },
    { key: "needs", name: "Needs", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const transitionDefinition = {
  name: "transition-wf",
  lanes: [
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      pipeline: [
        {
          key: "review",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "review",
          captureOutput: true,
        },
      ],
      transitions: [
        { when: { "==": [{ var: "steps.review.output.verdict" }, "pass"] }, to: "done" },
        { when: { "==": [{ var: "steps.review.output.verdict" }, "block"] }, to: "needs" },
      ],
      on: { success: "done" },
    },
    { key: "needs", name: "Needs", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const noRouteFailureDefinition = {
  name: "no-route-wf",
  lanes: [
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      pipeline: [
        {
          key: "fail",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "fail",
        },
      ],
    },
  ],
};

const routeDecisionLayer = it.layer(
  baseLayer(
    makeStubStepExecutor({
      default: { _tag: "completed" },
      byStepKey: {
        review: { _tag: "completed", output: { verdict: "block" } },
        fail: { _tag: "failed", error: "boom" },
      },
    }),
  ),
);

routeDecisionLayer("WorkflowEngine smart route decisions", (it) => {
  it.effect("step on success short-circuits remaining steps and emits route audit", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-step-on" as never, stepOnDefinition);
      const engine = yield* WorkflowEngine;
      const store = yield* WorkflowEventStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-step-on" as never,
        title: "Step route",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitLane(ticketId as string, "needs");
      assert.deepEqual(
        detail?.steps.map((step) => step.stepKey),
        ["first"],
      );

      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      const audit = events.find((event) => event.type === "TicketRouteDecided");
      assert.equal(audit?.type, "TicketRouteDecided");
      if (audit?.type !== "TicketRouteDecided") {
        assert.fail("expected TicketRouteDecided");
      }
      assert.equal(audit.payload.source, "step_on");
      assert.equal(audit.payload.toLane, "needs");
    }),
  );

  it.effect("lane transitions first-match before lane on fallback", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-transition" as never, transitionDefinition);
      const engine = yield* WorkflowEngine;
      const store = yield* WorkflowEventStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-transition" as never,
        title: "Transition route",
        initialLane: "impl" as never,
      });

      yield* awaitLane(ticketId as string, "needs");
      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      const audit = events.find((event) => event.type === "TicketRouteDecided");
      assert.equal(audit?.type, "TicketRouteDecided");
      if (audit?.type !== "TicketRouteDecided") {
        assert.fail("expected TicketRouteDecided");
      }
      assert.equal(audit.payload.source, "lane_transition");
      assert.equal(audit.payload.matchedTransitionIndex, 1);
      assert.deepEqual((audit.payload.contextSnapshot as any).steps.review.output, {
        verdict: "block",
      });
    }),
  );

  it.effect("lane on fallback still emits route audit", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-lane-on-audit" as never, definition);
      const engine = yield* WorkflowEngine;
      const store = yield* WorkflowEventStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-lane-on-audit" as never,
        title: "Lane route",
        initialLane: "impl" as never,
      });

      yield* awaitLane(ticketId as string, "done");
      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      const audit = events.find((event) => event.type === "TicketRouteDecided");
      assert.equal(audit?.type, "TicketRouteDecided");
      if (audit?.type !== "TicketRouteDecided") {
        assert.fail("expected TicketRouteDecided");
      }
      assert.equal(audit.payload.source, "lane_on");
      assert.equal(audit.payload.toLane, "done");
    }),
  );

  it.effect("failure with no route keeps TicketBlocked and emits no route audit", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-no-route" as never, noRouteFailureDefinition);
      const engine = yield* WorkflowEngine;
      const store = yield* WorkflowEventStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-no-route" as never,
        title: "No route",
        initialLane: "impl" as never,
      });

      const detail = yield* awaitStatus(ticketId as string, "blocked");
      assert.equal(detail?.ticket.status, "blocked");
      const events = yield* Stream.runCollect(store.readByTicket(ticketId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.isFalse(events.some((event) => event.type === "TicketRouteDecided"));
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "TicketBlocked" &&
            event.payload.reason === "pipeline failure with no route",
        ),
      );
    }),
  );

  it.effect("recovered step on success short-circuits remaining steps", () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-recovered-step-on" as never, stepOnDefinition);
      const engine = yield* WorkflowEngine;
      const committer = yield* WorkflowEventCommitter;
      const store = yield* WorkflowEventStore;

      yield* committer.commit({
        type: "TicketCreated",
        eventId: "evt-recovered-ticket" as never,
        ticketId: "ticket-recovered-step-on" as never,
        occurredAt: "2026-07-03T00:00:00.000Z" as never,
        payload: {
          boardId: "b-recovered-step-on" as never,
          title: "Recovered step",
          laneKey: "impl" as never,
        },
      } as never);
      yield* committer.commit({
        type: "TicketMovedToLane",
        eventId: "evt-recovered-move-in" as never,
        ticketId: "ticket-recovered-step-on" as never,
        occurredAt: "2026-07-03T00:00:01.000Z" as never,
        payload: {
          toLane: "impl" as never,
          laneEntryToken: "tok-recovered-step-on" as never,
          reason: "initial",
        },
      } as never);
      yield* committer.commit({
        type: "PipelineStarted",
        eventId: "evt-recovered-pipeline" as never,
        ticketId: "ticket-recovered-step-on" as never,
        occurredAt: "2026-07-03T00:00:02.000Z" as never,
        payload: {
          pipelineRunId: "pipeline-recovered-step-on" as never,
          laneKey: "impl" as never,
          laneEntryToken: "tok-recovered-step-on" as never,
        },
      } as never);
      yield* committer.commit({
        type: "StepStarted",
        eventId: "evt-recovered-step" as never,
        ticketId: "ticket-recovered-step-on" as never,
        occurredAt: "2026-07-03T00:00:03.000Z" as never,
        payload: {
          pipelineRunId: "pipeline-recovered-step-on" as never,
          stepRunId: "step-recovered-step-on" as never,
          stepKey: "first" as never,
          stepType: "agent",
        },
      } as never);

      yield* engine.completeRecoveredStep("step-recovered-step-on" as never, {
        _tag: "completed",
      });

      const detail = yield* awaitLane("ticket-recovered-step-on", "needs");
      assert.deepEqual(
        detail?.steps.map((step) => step.stepKey),
        ["first"],
      );
      const events = yield* Stream.runCollect(
        store.readByTicket("ticket-recovered-step-on" as never),
      ).pipe(Effect.map((chunk) => Array.from(chunk)));
      const audit = events.find((event) => event.type === "TicketRouteDecided");
      assert.equal(audit?.type, "TicketRouteDecided");
      if (audit?.type !== "TicketRouteDecided") {
        assert.fail("expected TicketRouteDecided");
      }
      assert.equal(audit.payload.source, "step_on");
      assert.equal(audit.payload.toLane, "needs");
    }),
  );
});

const awaitingUserDefinition = {
  name: "awaiting-user-wf",
  lanes: [
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      pipeline: [
        {
          key: "question",
          type: "agent",
          agent: { instance: "claude_main", model: "sonnet" },
          instruction: "ask",
        },
      ],
      on: { success: "done" },
    },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const awaitingUserExecutor = makeStubStepExecutor({
  default: {
    _tag: "awaiting_user",
    waitingReason: "Which API should I use?",
    providerThreadId: ThreadId.make("thread-ticket-answer"),
    providerRequestId: "request-ticket-answer" as never,
    providerResponseKind: "user-input",
    providerQuestionId: "question-api-choice",
  },
});

it.effect(
  "answerTicketStep posts both messages and delivers text to the live provider request",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-ticket-answer" as never, awaitingUserDefinition);
      const engine = yield* WorkflowEngine;
      const read = yield* WorkflowReadModel;

      const ticketId = yield* engine.createTicket({
        boardId: "b-ticket-answer" as never,
        title: "Answer me",
        initialLane: "impl" as never,
      });
      const waitingDetail = yield* awaitStatus(ticketId as string, "waiting_on_user");
      const stepRunId = waitingDetail?.steps[0]?.stepRunId;
      assert.isString(stepRunId);
      assert.deepEqual(
        waitingDetail?.messages.map((message) => [message.author, message.body]),
        [["agent", "Which API should I use?"]],
      );
      fake.control.appendActivity({
        threadId: ThreadId.make("thread-ticket-answer"),
        kind: "user-input.requested",
        payload: {
          requestId: "request-ticket-answer",
          questions: [{ id: "question-api-choice", question: "Which API should I use?" }],
        },
      });

      yield* engine.answerTicketStep({
        stepRunId: stepRunId as never,
        text: "Use the sandbox endpoint.",
        attachments: [],
      });

      assert.deepEqual(fake.control.userInputResponses(), [
        {
          threadId: ThreadId.make("thread-ticket-answer"),
          requestId: "request-ticket-answer",
          answers: { "question-api-choice": "Use the sandbox endpoint." },
        },
      ]);
      assert.deepEqual(
        (yield* read.getTicketDetail(ticketId))?.messages.map((message) => [
          message.author,
          message.body,
        ]),
        [
          ["agent", "Which API should I use?"],
          ["user", "Use the sandbox endpoint."],
        ],
      );
    }).pipe(Effect.provide(baseLayerWithAgentPort(awaitingUserExecutor, fake)));
  },
);

it.effect("answerTicketStep rejects stale provider user-input waits until live again", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    const registry = yield* BoardRegistry;
    yield* registry.register("b-ticket-stale-answer" as never, awaitingUserDefinition);
    const engine = yield* WorkflowEngine;
    const read = yield* WorkflowReadModel;

    const ticketId = yield* engine.createTicket({
      boardId: "b-ticket-stale-answer" as never,
      title: "Stale answer",
      initialLane: "impl" as never,
    });
    const waitingDetail = yield* awaitStatus(ticketId as string, "waiting_on_user");
    const stepRunId = waitingDetail?.steps[0]?.stepRunId;
    assert.isString(stepRunId);

    const staleExit = yield* engine
      .answerTicketStep({
        stepRunId: stepRunId as never,
        text: "This answer should not be dropped.",
      })
      .pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(staleExit));
    const staleError = Exit.isFailure(staleExit) ? Cause.squash(staleExit.cause) : null;
    assert.instanceOf(staleError, WorkflowEventStoreError);
    assert.match(
      (staleError as WorkflowEventStoreError).message,
      /provider user-input request is no longer pending/,
    );
    assert.deepEqual(fake.control.userInputResponses(), []);
    const detailAfterStale = yield* read.getTicketDetail(ticketId);
    assert.equal(detailAfterStale?.ticket.status, "waiting_on_user");
    assert.isFalse(detailAfterStale?.messages.some((message) => message.author === "user"));

    fake.control.appendActivity({
      threadId: ThreadId.make("thread-ticket-answer"),
      kind: "user-input.requested",
      payload: {
        requestId: "request-ticket-answer",
        questions: [{ id: "question-api-choice", question: "Which API should I use?" }],
      },
    });
    yield* engine.answerTicketStep({
      stepRunId: stepRunId as never,
      text: "Use the live answer.",
    });

    assert.deepEqual(fake.control.userInputResponses(), [
      {
        threadId: ThreadId.make("thread-ticket-answer"),
        requestId: "request-ticket-answer",
        answers: { "question-api-choice": "Use the live answer." },
      },
    ]);
  }).pipe(Effect.provide(baseLayerWithAgentPort(awaitingUserExecutor, fake)));
});

it.effect("answerTicketStep validation rejects unknown and non-awaiting steps", () =>
  Effect.gen(function* () {
    const engine = yield* WorkflowEngine;
    const read = yield* WorkflowReadModel;

    const unknownExit = yield* engine
      .answerTicketStep({
        stepRunId: "step-run-does-not-exist" as never,
        text: "an answer that should not be dropped",
        attachments: [],
      })
      .pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(unknownExit));
    const unknownError = Exit.isFailure(unknownExit) ? Cause.squash(unknownExit.cause) : null;
    assert.instanceOf(unknownError, WorkflowEventStoreError);
    assert.match(
      (unknownError as WorkflowEventStoreError).message,
      /step-run-does-not-exist not found/,
    );

    const registry = yield* BoardRegistry;
    yield* registry.register("b-ticket-answer-validations" as never, awaitingUserDefinition);
    const completedTicketId = yield* engine.createTicket({
      boardId: "b-ticket-answer-validations" as never,
      title: "Already done",
      initialLane: "impl" as never,
    });
    const doneDetail = yield* awaitLane(completedTicketId as string, "done");
    const completedStepRunId = doneDetail?.steps[0]?.stepRunId;
    assert.isString(completedStepRunId);
    const nonAwaitingExit = yield* engine
      .answerTicketStep({
        stepRunId: completedStepRunId as never,
        text: "This should not post.",
      })
      .pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(nonAwaitingExit));
    assert.deepEqual((yield* read.getTicketDetail(completedTicketId))?.messages, []);
  }).pipe(Effect.provide(baseLayer(makeStubStepExecutor({ default: { _tag: "completed" } })))),
);

it.effect("answerTicketStep rejects attachment-only answers without posting a user message", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    const registry = yield* BoardRegistry;
    yield* registry.register("b-ticket-image-only" as never, awaitingUserDefinition);
    const engine = yield* WorkflowEngine;
    const read = yield* WorkflowReadModel;

    const ticketId = yield* engine.createTicket({
      boardId: "b-ticket-image-only" as never,
      title: "Need screenshot",
      initialLane: "impl" as never,
    });
    const waitingDetail = yield* awaitStatus(ticketId as string, "waiting_on_user");
    const stepRunId = waitingDetail?.steps[0]?.stepRunId;
    assert.isString(stepRunId);
    const exit = yield* engine
      .answerTicketStep({
        stepRunId: stepRunId as never,
        attachments: [
          {
            kind: "image",
            id: "image-only",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1200,
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      })
      .pipe(Effect.exit);

    assert.isTrue(Exit.isFailure(exit));
    const detail = yield* read.getTicketDetail(ticketId);
    assert.deepEqual(
      detail?.messages.map((message) => [message.author, message.body]),
      [["agent", "Which API should I use?"]],
    );
    assert.deepEqual(fake.control.userInputResponses(), []);
  }).pipe(Effect.provide(baseLayerWithAgentPort(awaitingUserExecutor, fake)));
});

it.effect(
  "answerTicketStep rejects provider approval requests without posting a user message",
  () =>
    Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-ticket-approval-answer" as never, awaitingUserDefinition);
      const engine = yield* WorkflowEngine;
      const read = yield* WorkflowReadModel;

      const ticketId = yield* engine.createTicket({
        boardId: "b-ticket-approval-answer" as never,
        title: "Approve me",
        initialLane: "impl" as never,
      });
      const waitingDetail = yield* awaitStatus(ticketId as string, "waiting_on_user");
      const stepRunId = waitingDetail?.steps[0]?.stepRunId;
      assert.isString(stepRunId);
      const exit = yield* engine
        .answerTicketStep({
          stepRunId: stepRunId as never,
          text: "This should not be accepted.",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      assert.deepEqual((yield* read.getTicketDetail(ticketId))?.messages, []);
    }).pipe(
      Effect.provide(
        baseLayer(
          makeStubStepExecutor({
            default: {
              _tag: "awaiting_user",
              waitingReason: "Approve this command?",
              providerThreadId: ThreadId.make("thread-ticket-request"),
              providerRequestId: "request-ticket-request" as never,
              providerResponseKind: "request",
            },
          }),
        ),
      ),
    ),
);

it.effect(
  "editTicketMessage edits a free-standing user comment and rejects everything else",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-ticket-edit" as never, awaitingUserDefinition);
      const engine = yield* WorkflowEngine;
      const read = yield* WorkflowReadModel;

      const ticketId = yield* engine.createTicket({
        boardId: "b-ticket-edit" as never,
        title: "Edit me",
        initialLane: "impl" as never,
      });
      const waitingDetail = yield* awaitStatus(ticketId as string, "waiting_on_user");
      const stepRunId = waitingDetail?.steps[0]?.stepRunId;
      const agentMessageId = waitingDetail?.messages.find(
        (message) => message.author === "agent",
      )?.messageId;
      assert.isString(stepRunId);
      assert.isString(agentMessageId);

      yield* engine.postTicketMessage({
        ticketId,
        text: "original comment",
        attachments: [],
      });
      fake.control.appendActivity({
        threadId: ThreadId.make("thread-ticket-answer"),
        kind: "user-input.requested",
        payload: {
          requestId: "request-ticket-answer",
          questions: [{ id: "question-api-choice", question: "Which API should I use?" }],
        },
      });
      yield* engine.answerTicketStep({
        stepRunId: stepRunId as never,
        text: "Use the sandbox endpoint.",
        attachments: [],
      });

      const detailAfter = yield* read.getTicketDetail(ticketId);
      const freeStanding = detailAfter?.messages.find(
        (message) => message.author === "user" && message.stepRunId === null,
      );
      const stepBound = detailAfter?.messages.find(
        (message) => message.author === "user" && message.stepRunId !== null,
      );
      assert.isString(freeStanding?.messageId);
      assert.isString(stepBound?.messageId);

      yield* engine.editTicketMessage({
        ticketId,
        messageId: freeStanding?.messageId as never,
        body: "edited comment",
      });
      const detailEdited = yield* read.getTicketDetail(ticketId);
      const editedMessage = detailEdited?.messages.find(
        (message) => message.messageId === freeStanding?.messageId,
      );
      assert.equal(editedMessage?.body, "edited comment");
      assert.isNotNull(editedMessage?.editedAt);

      const unknownExit = yield* engine
        .editTicketMessage({
          ticketId,
          messageId: "message-does-not-exist" as never,
          body: "nope",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(unknownExit));

      const agentExit = yield* engine
        .editTicketMessage({
          ticketId,
          messageId: agentMessageId as never,
          body: "rewriting the agent",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(agentExit));

      const stepExit = yield* engine
        .editTicketMessage({
          ticketId,
          messageId: stepBound?.messageId as never,
          body: "rewriting the answer",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(stepExit));
    }).pipe(Effect.provide(baseLayerWithAgentPort(awaitingUserExecutor, fake)));
  },
);
