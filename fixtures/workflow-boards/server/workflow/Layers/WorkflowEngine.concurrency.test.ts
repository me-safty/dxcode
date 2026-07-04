import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { StepExecutor, type StepExecutorShape } from "../Services/StepExecutor.ts";
import { WorkflowBoardSaveLocks } from "../Services/WorkflowBoardSaveLocks.ts";
import { WorkflowEngine } from "../Services/WorkflowEngine.ts";
import { WorkflowEventStore } from "../Services/WorkflowEventStore.ts";
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
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEngineLayer } from "./WorkflowEngine.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";
import { WorkflowRoutingContextBuilderLive } from "./WorkflowRoutingContextBuilder.ts";

const definition = {
  name: "limited",
  settings: { maxConcurrentTickets: 1 },
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
      on: { success: "done" },
    },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

let activeExecutions = 0;
let maxActiveExecutions = 0;

const countingExecutor = Layer.succeed(StepExecutor, {
  execute: () =>
    Effect.gen(function* () {
      activeExecutions += 1;
      maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
      yield* Effect.sleep("20 millis");
      activeExecutions -= 1;
      return { _tag: "completed" as const };
    }),
} satisfies StepExecutorShape);

const scriptCancelNoop = Layer.succeed(ScriptCancelRegistry, {
  register: () => Effect.void,
  unregister: () => Effect.void,
  cancel: () => Effect.void,
});

const workflowAgentPortLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowAgentPortLive.pipe(Layer.provideMerge(fake.layer), Layer.provideMerge(TestSql));

const engineLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(countingExecutor),
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

const layer = it.layer(engineLayer(makeWorkflowAgentPortFake()));

layer("WorkflowEngine concurrency", (it) => {
  it.effect("caps simultaneously running tickets per board", () =>
    Effect.gen(function* () {
      activeExecutions = 0;
      maxActiveExecutions = 0;

      const registry = yield* BoardRegistry;
      yield* registry.register("b-limit" as never, definition);
      const engine = yield* WorkflowEngine;

      yield* Effect.all(
        [
          engine.createTicket({
            boardId: "b-limit" as never,
            title: "First",
            initialLane: "impl" as never,
          }),
          engine.createTicket({
            boardId: "b-limit" as never,
            title: "Second",
            initialLane: "impl" as never,
          }),
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(maxActiveExecutions, 1);
    }),
  );

  it.effect("applies a raised maxConcurrentTickets without a server restart", () =>
    Effect.gen(function* () {
      activeExecutions = 0;
      maxActiveExecutions = 0;

      const registry = yield* BoardRegistry;
      yield* registry.register("b-resize" as never, definition);
      const engine = yield* WorkflowEngine;

      yield* Effect.all(
        [
          engine.createTicket({
            boardId: "b-resize" as never,
            title: "First",
            initialLane: "impl" as never,
          }),
          engine.createTicket({
            boardId: "b-resize" as never,
            title: "Second",
            initialLane: "impl" as never,
          }),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(maxActiveExecutions, 1);

      yield* registry.register("b-resize" as never, {
        ...definition,
        settings: { maxConcurrentTickets: 2 },
      });
      activeExecutions = 0;
      maxActiveExecutions = 0;

      yield* Effect.all(
        [
          engine.createTicket({
            boardId: "b-resize" as never,
            title: "Third",
            initialLane: "impl" as never,
          }),
          engine.createTicket({
            boardId: "b-resize" as never,
            title: "Fourth",
            initialLane: "impl" as never,
          }),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(maxActiveExecutions, 2);
    }),
  );

  it.effect("rejects createTicket that races after a board delete under the save lock", () =>
    Effect.gen(function* () {
      const boardId = "b-delete-race" as never;
      const registry = yield* BoardRegistry;
      const engine = yield* WorkflowEngine;
      const eventStore = yield* WorkflowEventStore;
      const saveLocks = yield* WorkflowBoardSaveLocks;
      const sql = yield* SqlClient.SqlClient;
      const deleteReady = yield* Deferred.make<void>();
      const releaseDelete = yield* Deferred.make<void>();

      yield* registry.register(boardId, {
        name: "delete-race",
        lanes: [{ key: "todo", name: "Todo", entry: "manual" }],
      });

      const deleteFiber = yield* saveLocks
        .withSaveLock(
          boardId,
          Effect.gen(function* () {
            yield* registry.unregister(boardId);
            yield* eventStore.deleteForBoard(boardId);
            yield* Deferred.succeed(deleteReady, undefined);
            yield* Deferred.await(releaseDelete);
          }),
        )
        .pipe(Effect.forkChild);

      yield* Deferred.await(deleteReady);
      const createFiber = yield* engine
        .createTicket({
          boardId,
          title: "Should not survive",
          initialLane: "todo" as never,
        })
        .pipe(Effect.exit, Effect.forkChild);

      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseDelete, undefined);
      yield* Fiber.join(deleteFiber);

      const createResult = yield* Fiber.join(createFiber);
      assert.isTrue(Exit.isFailure(createResult));

      const counts = yield* sql<{ readonly tableName: string; readonly count: number }>`
        SELECT 'p_workflow_boards_projection_ticket' AS tableName, COUNT(*) AS count
        FROM p_workflow_boards_projection_ticket
        WHERE board_id = ${boardId}
        UNION ALL
        SELECT 'p_workflow_boards_events' AS tableName, COUNT(*) AS count
        FROM p_workflow_boards_events
        WHERE json_extract(payload_json, '$.boardId') = ${boardId}
      `;

      assert.deepEqual(
        counts.map((row) => [row.tableName, row.count]),
        [
          ["p_workflow_boards_projection_ticket", 0],
          ["p_workflow_boards_events", 0],
        ],
      );
    }),
  );
});

const seedProviderCancelRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = "2026-07-03T00:00:00.000Z";

  yield* sql`
    INSERT INTO p_workflow_boards_projection_ticket (
      ticket_id,
      board_id,
      title,
      current_lane_key,
      status,
      created_at,
      updated_at
    )
    VALUES
      ('ticket-active-provider', 'board-provider-cancel', 'Active provider', 'impl', 'running', ${now}, ${now}),
      ('ticket-other-provider', 'board-other-provider', 'Other provider', 'impl', 'running', ${now}, ${now}),
      ('ticket-provider-delete-one', 'board-provider-delete-one', 'Delete provider', 'impl', 'running', ${now}, ${now}),
      ('ticket-provider-keep-one', 'board-provider-delete-one', 'Keep provider', 'impl', 'running', ${now}, ${now})
  `;
  yield* sql`
    INSERT INTO p_workflow_boards_dispatch_outbox (
      dispatch_id,
      ticket_id,
      step_run_id,
      thread_id,
      message_id,
      provider_instance,
      model,
      instruction,
      worktree_path,
      status,
      created_at,
      started_at
    )
    VALUES
      ('dispatch-active-provider', 'ticket-active-provider', 'step-active-provider', 'thread-active-provider', 'message-active-provider', 'codex', 'gpt-5.5', 'cancel me', '/tmp/active-provider', 'projected', ${now}, ${now}),
      ('dispatch-other-provider', 'ticket-other-provider', 'step-other-provider', 'thread-other-provider', 'message-other-provider', 'codex', 'gpt-5.5', 'keep me', '/tmp/other-provider', 'projected', ${now}, ${now}),
      ('dispatch-pending-provider', 'ticket-active-provider', 'step-pending-provider', 'thread-pending-provider', NULL, 'codex', 'gpt-5.5', 'not started', '/tmp/pending-provider', 'start_requested', ${now}, NULL),
      ('dispatch-provider-delete-one', 'ticket-provider-delete-one', 'step-provider-delete-one', 'thread-provider-delete-one', 'message-provider-delete-one', 'codex', 'gpt-5.5', 'cancel me', '/tmp/delete-one', 'projected', ${now}, ${now}),
      ('dispatch-provider-keep-one', 'ticket-provider-keep-one', 'step-provider-keep-one', 'thread-provider-keep-one', 'message-provider-keep-one', 'codex', 'gpt-5.5', 'keep me', '/tmp/keep-one', 'projected', ${now}, ${now}),
      ('dispatch-provider-pending-one', 'ticket-provider-delete-one', 'step-provider-pending-one', 'thread-provider-pending-one', NULL, 'codex', 'gpt-5.5', 'not started', '/tmp/pending-one', 'start_requested', ${now}, NULL)
  `;
});

it.effect("cancelBoardPipelines interrupts and stops active agent turns for board tickets", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    const engine = yield* WorkflowEngine;
    yield* seedProviderCancelRows;

    yield* engine
      .cancelBoardPipelines("board-provider-cancel" as never)
      .pipe(Effect.timeout("1 second"));

    assert.deepEqual(fake.control.interruptCalls().map(String), [
      "thread-active-provider",
      "thread-pending-provider",
    ]);
    assert.deepEqual(fake.control.stopCalls().map(String), [
      "thread-active-provider",
      "thread-pending-provider",
    ]);
  }).pipe(Effect.provide(engineLayer(fake)));
});

it.effect("cancelTicketPipelines interrupts and stops active agent turns for one ticket", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    const engine = yield* WorkflowEngine;
    yield* seedProviderCancelRows;

    yield* engine
      .cancelTicketPipelines("ticket-provider-delete-one" as never)
      .pipe(Effect.timeout("1 second"));

    assert.deepEqual(fake.control.interruptCalls().map(String), [
      "thread-provider-delete-one",
      "thread-provider-pending-one",
    ]);
    assert.deepEqual(fake.control.stopCalls().map(String), [
      "thread-provider-delete-one",
      "thread-provider-pending-one",
    ]);
  }).pipe(Effect.provide(engineLayer(fake)));
});
