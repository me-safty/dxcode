// @effect-diagnostics globalTimers:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { WorkflowAgentSessionStore } from "../Services/WorkflowAgentSessionStore.ts";
import { WorkflowBoardSaveLocks } from "../Services/WorkflowBoardSaveLocks.ts";
import { WorkflowEngine } from "../Services/WorkflowEngine.ts";
import { TestSql } from "../testHarness.ts";
import {
  makeWorkflowAgentPortFake,
  type WorkflowAgentPortFake,
} from "../WorkflowAgentPort.fake.ts";
import { WorkflowFoundationLive } from "../WorkflowFoundationLive.ts";
import { ApprovalGateLive } from "./ApprovalGate.ts";
import { BoardRegistryLive } from "./BoardRegistry.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { makeStubStepExecutor } from "./StubStepExecutor.ts";
import { WorkflowAgentPortLive } from "./WorkflowAgentPort.ts";
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEngineLayer } from "./WorkflowEngine.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";
import { WorkflowRoutingContextBuilderLive } from "./WorkflowRoutingContextBuilder.ts";

const workflowAgentPortLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowAgentPortLive.pipe(Layer.provideMerge(fake.layer), Layer.provideMerge(TestSql));

const makeLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(makeStubStepExecutor({ default: { _tag: "blocked", reason: "unused" } })),
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

const scriptCancelNoop = Layer.succeed(ScriptCancelRegistry, {
  register: () => Effect.void,
  unregister: () => Effect.void,
  cancel: () => Effect.void,
});

const definition = {
  name: "session teardown",
  lanes: [
    { key: "inbox", name: "Inbox", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const inLockAndTx = <A, E>(boardId: string, body: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const saveLocks = yield* WorkflowBoardSaveLocks;
    const sql = yield* SqlClient.SqlClient;
    return yield* saveLocks.withSaveLock(boardId as never, sql.withTransaction(body));
  });

it.effect(
  "terminal entry via the normal move tears down the ticket's stored agent sessions",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-teardown-normal" as never, definition);
      const engine = yield* WorkflowEngine;
      const sessions = yield* WorkflowAgentSessionStore;

      const ticketId = yield* engine.createTicket({
        boardId: "b-teardown-normal" as never,
        title: "Has a session",
        initialLane: "inbox" as never,
      });

      yield* sessions.upsert(ticketId, "inbox" as never, "agent-a", "thread-teardown-1");
      assert.equal((yield* sessions.listByTicket(ticketId)).length, 1);

      yield* engine.moveTicket(ticketId, "done" as never);

      assert.equal((yield* sessions.listByTicket(ticketId)).length, 0);
      assert.deepEqual(fake.control.interruptCalls().map(String), ["thread-teardown-1"]);
      assert.deepEqual(fake.control.stopCalls().map(String), ["thread-teardown-1"]);
    }).pipe(Effect.provide(makeLayer(fake)));
  },
);

it.effect(
  "closeTicketFromSourceUnlocked into a terminal lane deletes stored sessions in-tx and defers the live stop",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return Effect.gen(function* () {
      const registry = yield* BoardRegistry;
      yield* registry.register("b-teardown-close" as never, definition);
      const engine = yield* WorkflowEngine;
      const sessions = yield* WorkflowAgentSessionStore;

      const created = yield* inLockAndTx(
        "b-teardown-close",
        engine.createTicketAndEnterUnlocked({
          boardId: "b-teardown-close" as never,
          title: "Close me",
          destinationLane: "inbox" as never,
        }),
      );

      yield* sessions.upsert(created.ticketId, "inbox" as never, "agent-a", "thread-teardown-2");
      assert.equal((yield* sessions.listByTicket(created.ticketId)).length, 1);

      const snapshot = yield* inLockAndTx(
        "b-teardown-close",
        Effect.gen(function* () {
          const threads = yield* engine.terminalAgentSessionThreadsForTicket(created.ticketId);
          yield* engine.closeTicketFromSourceUnlocked(created.ticketId, "done" as never);
          return threads;
        }),
      );

      assert.equal((yield* sessions.listByTicket(created.ticketId)).length, 0);
      assert.deepEqual(snapshot, ["thread-teardown-2"]);
      assert.deepEqual(fake.control.stopCalls(), []);

      yield* engine.stopAgentSessionsForTicket(snapshot);
      assert.deepEqual(fake.control.interruptCalls().map(String), ["thread-teardown-2"]);
      assert.deepEqual(fake.control.stopCalls().map(String), ["thread-teardown-2"]);
    }).pipe(Effect.provide(makeLayer(fake)));
  },
);

it.effect("a non-terminal move never tears down stored agent sessions", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    const registry = yield* BoardRegistry;
    yield* registry.register("b-teardown-noop" as never, {
      name: "no teardown",
      lanes: [
        { key: "inbox", name: "Inbox", entry: "manual" },
        { key: "review", name: "Review", entry: "manual" },
      ],
    });
    const engine = yield* WorkflowEngine;
    const sessions = yield* WorkflowAgentSessionStore;

    const ticketId = yield* engine.createTicket({
      boardId: "b-teardown-noop" as never,
      title: "Stays open",
      initialLane: "inbox" as never,
    });
    yield* sessions.upsert(ticketId, "inbox" as never, "agent-a", "thread-noop");

    yield* engine.moveTicket(ticketId, "review" as never);

    assert.equal((yield* sessions.listByTicket(ticketId)).length, 1);
    assert.deepEqual(fake.control.interruptCalls().map(String), []);
    assert.deepEqual(fake.control.stopCalls().map(String), []);
  }).pipe(Effect.provide(makeLayer(fake)));
});
