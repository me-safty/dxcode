import {
  ApprovalRequestId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardId, DispatchId, StepRunId, TicketId } from "../../../contracts/workflow.ts";
import { resolvePendingRequest } from "../pendingRequestFilter.ts";
import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { WorkflowAgentPort, workflowDispatchCommandId } from "../Services/WorkflowAgentPort.ts";
import { TestSql } from "../testHarness.ts";
import {
  makeWorkflowAgentPortFake,
  type WorkflowAgentPortFake,
} from "../WorkflowAgentPort.fake.ts";
import { WorkflowAgentPortLive } from "./WorkflowAgentPort.ts";

const layerFor = (fake: WorkflowAgentPortFake) =>
  WorkflowAgentPortLive.pipe(Layer.provideMerge(fake.layer), Layer.provideMerge(TestSql));

const runWithFake = <A, E>(
  fake: WorkflowAgentPortFake,
  effect: Effect.Effect<A, E, WorkflowAgentPort | SqlClient.SqlClient>,
) => effect.pipe(Effect.provide(layerFor(fake)));

const baseDispatch = (suffix: string, threadId = ThreadId.make(`thread-${suffix}`)) => ({
  dispatchId: DispatchId.make(`dispatch-${suffix}`),
  ticketId: TicketId.make(`ticket-${suffix}`),
  stepRunId: StepRunId.make(`step-${suffix}`),
  threadId,
  providerInstance: "codex",
  model: "gpt-5-codex",
  instruction: `Do work ${suffix}`,
  worktreePath: `/tmp/worktree-${suffix}`,
  projectId: ProjectId.make(`project-${suffix}`),
  threadTitle: `Workflow ${suffix}`,
  runtimeMode: "full-access" as const,
});

const seedBoardAndTicket = (
  sql: SqlClient.SqlClient,
  input: {
    readonly boardId: BoardId;
    readonly ticketId: TicketId;
    readonly laneEntryToken?: string | null | undefined;
  },
) => {
  const now = "2026-07-03T00:00:00.000Z";
  return Effect.gen(function* () {
    yield* sql`
      INSERT OR IGNORE INTO p_workflow_boards_projection_board
        (board_id, project_id, name, workflow_file_path, workflow_version_hash, max_concurrent_tickets)
      VALUES
        (${String(input.boardId)}, 'project', 'Board', '.t3/workflow.json', 'hash', 1)
    `;
    yield* sql`
      INSERT OR REPLACE INTO p_workflow_boards_projection_ticket
        (ticket_id, board_id, title, current_lane_key, status, created_at, updated_at, current_lane_entry_token)
      VALUES
        (${String(input.ticketId)}, ${String(input.boardId)}, 'Ticket', 'lane-build', 'running', ${now}, ${now}, ${input.laneEntryToken ?? null})
    `;
  });
};

const seedRunningPipelineStep = (
  sql: SqlClient.SqlClient,
  input: {
    readonly ticketId: TicketId;
    readonly stepRunId: StepRunId;
    readonly pipelineRunId: string;
    readonly laneEntryToken?: string | undefined;
  },
) => {
  const now = "2026-07-03T00:00:00.000Z";
  const laneEntryToken = input.laneEntryToken ?? "lane-token";
  return Effect.gen(function* () {
    yield* sql`
      INSERT OR REPLACE INTO p_workflow_boards_projection_pipeline_run
        (pipeline_run_id, ticket_id, lane_key, lane_entry_token, status, started_at)
      VALUES
        (${input.pipelineRunId}, ${String(input.ticketId)}, 'lane-build', ${laneEntryToken}, 'running', ${now})
    `;
    yield* sql`
      INSERT OR REPLACE INTO p_workflow_boards_projection_step_run
        (step_run_id, pipeline_run_id, ticket_id, step_key, step_type, status, started_at, attempt)
      VALUES
        (${String(input.stepRunId)}, ${input.pipelineRunId}, ${String(input.ticketId)}, 'build', 'agent', 'running', ${now}, 1)
    `;
  });
};

const insertOutbox = (
  sql: SqlClient.SqlClient,
  input: {
    readonly dispatchId: DispatchId;
    readonly ticketId: TicketId;
    readonly stepRunId: StepRunId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly status: string;
  },
) =>
  sql`
    INSERT INTO p_workflow_boards_dispatch_outbox (
      dispatch_id,
      ticket_id,
      step_run_id,
      thread_id,
      turn_id,
      message_id,
      provider_instance,
      model,
      instruction,
      worktree_path,
      status,
      created_at
    )
    VALUES (
      ${String(input.dispatchId)},
      ${String(input.ticketId)},
      ${String(input.stepRunId)},
      ${String(input.threadId)},
      NULL,
      ${String(input.messageId)},
      'codex',
      'gpt-5-codex',
      'Recover this',
      '/tmp/worktree',
      ${input.status},
      '2026-07-03T00:00:00.000Z'
    )
  `;

const readOutbox = (sql: SqlClient.SqlClient, dispatchId: DispatchId) =>
  sql<{ readonly status: string; readonly messageId: string | null }>`
    SELECT status, message_id AS "messageId"
    FROM p_workflow_boards_dispatch_outbox
    WHERE dispatch_id = ${String(dispatchId)}
  `.pipe(Effect.map((rows) => rows[0] ?? null));

const activity = (
  id: string,
  kind: string,
  payload: unknown,
  createdAt = "2026-07-03T00:00:00.000Z",
): OrchestrationThreadActivity =>
  ({
    id,
    tone: kind.includes("approval") ? "approval" : kind.includes("failed") ? "error" : "info",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt,
  }) as OrchestrationThreadActivity;

describe("resolvePendingRequest", () => {
  it("surfaces requested-only approvals and excludes resolved approvals", () => {
    assert.deepEqual(
      resolvePendingRequest([activity("a1", "approval.requested", { requestId: "approval-1" })]),
      { kind: "request", requestId: ApprovalRequestId.make("approval-1") },
    );
    assert.equal(
      resolvePendingRequest([
        activity("a1", "approval.requested", { requestId: "approval-1" }),
        activity(
          "a2",
          "approval.resolved",
          { requestId: "approval-1", decision: "accept" },
          "2026-07-03T00:00:01.000Z",
        ),
      ]),
      null,
    );
  });

  it("ports user-input latest-state and stale-detail exclusions", () => {
    assert.deepEqual(
      resolvePendingRequest([
        activity("u1", "user-input.requested", {
          requestId: "input-1",
          questions: [{ id: "scope", question: "Scope?" }],
        }),
      ]),
      {
        kind: "user-input",
        requestId: ApprovalRequestId.make("input-1"),
        questionId: "scope",
        prompt: "Scope?",
      },
    );
    assert.equal(
      resolvePendingRequest([
        activity("u1", "user-input.requested", { requestId: "input-1" }),
        activity("u2", "user-input.resolved", { requestId: "input-1" }, "2026-07-03T00:00:01.000Z"),
      ]),
      null,
    );
    assert.equal(
      resolvePendingRequest([
        activity("u1", "user-input.requested", { requestId: "input-1" }),
        activity(
          "u2",
          "provider.user-input.respond.failed",
          { requestId: "input-1", detail: "Unknown pending Codex user input request: input-1" },
          "2026-07-03T00:00:01.000Z",
        ),
      ]),
      null,
    );
    assert.deepEqual(
      resolvePendingRequest([
        activity(
          "u2",
          "provider.user-input.respond.failed",
          { requestId: "input-2", detail: "transport failed" },
          "2026-07-03T00:00:01.000Z",
        ),
      ]),
      { kind: "user-input", requestId: ApprovalRequestId.make("input-2") },
    );
  });
});

const portIt = it;
const isWorkflowEventStoreError = Schema.is(WorkflowEventStoreError);

portIt.effect(
  "happy path dispatches, awaits terminal, and reads turn-correlated JSON output",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("happy");

        const started = yield* port.ensureStarted(req);
        fake.control.completeTurn({
          messageId: started.messageId,
          text: 'done\n```json\n{"ok":true,"step":"happy"}\n```',
        });

        const terminal = yield* port.awaitTerminal(req.dispatchId, req.threadId);
        const output = yield* port.readCapturedOutput({
          stepRunId: req.stepRunId,
          threadId: req.threadId,
          messageId: started.messageId,
        });
        const dispatch = yield* port.getDispatchForStep(req.stepRunId);
        const row = yield* readOutbox(sql, req.dispatchId);

        assert.deepEqual(terminal, { ok: true });
        assert.deepEqual(output, { ok: true, step: "happy" });
        assert.deepEqual(dispatch, { threadId: req.threadId, messageId: started.messageId });
        assert.equal(row?.status, "terminal");
      }),
    );
  },
);

portIt.effect(
  "awaitTerminal re-observes a running turn after restart and returns completed terminal",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("restart-complete");
        const messageId = MessageId.make("message-restart-complete");
        yield* insertOutbox(sql, { ...req, messageId, status: "start_requested" });
        fake.control.seedStartedTurn({
          threadId: req.threadId,
          messageId,
          state: "running",
        });
        fake.control.completeTurnAfterListTurnsReads({ messageId, text: "done" }, 2);

        const terminal = yield* port.awaitTerminal(req.dispatchId, req.threadId);
        const row = yield* readOutbox(sql, req.dispatchId);

        assert.deepEqual(terminal, { ok: true });
        assert.equal(row?.status, "terminal");
      }),
    );
  },
);

portIt.effect(
  "awaitTerminal after restart returns awaitingUser for a running turn with pending approval",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("restart-pending");
        const messageId = MessageId.make("message-restart-pending");
        yield* insertOutbox(sql, { ...req, messageId, status: "start_requested" });
        fake.control.seedStartedTurn({
          threadId: req.threadId,
          messageId,
          state: "running",
        });
        fake.control.appendActivity({
          threadId: req.threadId,
          kind: "approval.requested",
          payload: { requestId: "approval-restart" },
        });

        const terminal = yield* port.awaitTerminal(req.dispatchId, req.threadId);

        assert.deepEqual(terminal, {
          ok: false,
          awaitingUser: true,
          waitingReason: "Provider is waiting for user input",
          providerThreadId: req.threadId,
          providerRequestId: ApprovalRequestId.make("approval-restart"),
          providerResponseKind: "request",
        });
      }),
    );
  },
);

portIt.effect("awaitTerminal prefers a terminal projection over a stale pending request", () => {
  const fake = makeWorkflowAgentPortFake();
  fake.control.setAwaitTurnDelay("50 millis");
  return runWithFake(
    fake,
    Effect.gen(function* () {
      const port = yield* WorkflowAgentPort;
      const req = baseDispatch("terminal-first");
      const started = yield* port.ensureStarted(req);
      fake.control.appendActivity({
        threadId: req.threadId,
        kind: "approval.requested",
        payload: { requestId: "approval-stale" },
      });
      fake.control.completeTurn({
        messageId: started.messageId,
        text: "failed",
        state: "error",
      });

      const terminal = yield* port.awaitTerminal(req.dispatchId, req.threadId);

      assert.deepEqual(terminal, { ok: false, error: "error" });
    }),
  );
});

portIt.effect(
  "crash-window recovery replays the same commandId without duplicating the turn",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("crash");
        const boardId = BoardId.make("board-crash");
        const messageId = MessageId.make("message-crash");
        yield* seedBoardAndTicket(sql, { boardId, ticketId: req.ticketId });
        fake.control.seedStartedTurn({
          threadId: req.threadId,
          messageId,
          commandId: workflowDispatchCommandId(req.dispatchId),
        });
        yield* insertOutbox(sql, { ...req, messageId, status: "reserved" });

        yield* port.recoverPending();
        const row = yield* readOutbox(sql, req.dispatchId);

        assert.equal(fake.control.startTurnCallCount(), 1);
        assert.equal(fake.control.startCommandCount(), 1);
        assert.equal(row?.status, "start_requested");
        assert.equal(row?.messageId, messageId);
      }),
    );
  },
);

portIt.effect(
  "awaiting_projection recovery waits for projection lag and resumes a supervised running turn",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("projection-lag");
        const boardId = BoardId.make("board-projection-lag");
        const messageId = MessageId.make("message-projection-lag");
        yield* seedBoardAndTicket(sql, {
          boardId,
          ticketId: req.ticketId,
          laneEntryToken: "lane-token",
        });
        yield* seedRunningPipelineStep(sql, {
          ticketId: req.ticketId,
          stepRunId: req.stepRunId,
          pipelineRunId: "pipeline-projection-lag",
        });
        yield* insertOutbox(sql, { ...req, messageId, status: "start_requested" });

        const fiber = yield* port
          .recoverPending()
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        fake.control.seedStartedTurn({
          threadId: req.threadId,
          messageId,
          state: "running",
        });
        yield* TestClock.adjust("200 millis");
        yield* Fiber.join(fiber);
        const row = yield* readOutbox(sql, req.dispatchId);

        assert.equal(fake.control.startTurnCallCount(), 0);
        assert.equal(row?.status, "projected");
        assert.deepEqual(fake.control.interruptCalls(), []);
        assert.deepEqual(fake.control.stopCalls(), []);
      }),
    );
  },
);

portIt.effect(
  "awaiting_projection recovery abandons after the projection-lag budget when no turn projects",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const sql = yield* SqlClient.SqlClient;
        const req = baseDispatch("projection");
        const retryReq = baseDispatch("projection-retry", req.threadId);
        const boardId = BoardId.make("board-projection");
        const messageId = MessageId.make("message-awaiting-projection");
        yield* seedBoardAndTicket(sql, { boardId, ticketId: req.ticketId });
        yield* insertOutbox(sql, { ...req, messageId, status: "start_requested" });

        const fiber = yield* port
          .recoverPending()
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(fiber);
        const abandoned = yield* readOutbox(sql, req.dispatchId);
        const retry = yield* port.ensureStarted(retryReq);
        const retryRow = yield* readOutbox(sql, retryReq.dispatchId);

        assert.equal(fake.control.startCommandCount(), 1);
        assert.equal(abandoned?.status, "abandoned");
        assert.notEqual(retry.messageId, messageId);
        assert.equal(retryRow?.status, "start_requested");
        assert.deepEqual(fake.control.interruptCalls(), [req.threadId]);
      }),
    );
  },
);

portIt.effect("pending request reads fail closed when activity projection is unavailable", () => {
  const fake = makeWorkflowAgentPortFake();
  return runWithFake(
    fake,
    Effect.gen(function* () {
      const port = yield* WorkflowAgentPort;
      const req = baseDispatch("pending-read-failure");
      yield* port.ensureStarted(req);
      fake.control.appendActivity({
        threadId: req.threadId,
        kind: "approval.requested",
        payload: { requestId: "approval-resolved" },
      });
      fake.control.appendActivity({
        threadId: req.threadId,
        kind: "approval.resolved",
        payload: { requestId: "approval-resolved", decision: "accept" },
        createdAt: "2026-07-03T00:00:01.000Z",
      });
      fake.control.failActivityReads(new Error("activity projection unavailable"));

      const failure = yield* port.awaitTerminal(req.dispatchId, req.threadId).pipe(Effect.flip);

      assert.ok(isWorkflowEventStoreError(failure));
      assert.equal(failure.message, "pending request read failed");
    }),
  );
});

portIt.effect("two turns on one thread read their own captured output", () => {
  const fake = makeWorkflowAgentPortFake();
  return runWithFake(
    fake,
    Effect.gen(function* () {
      const port = yield* WorkflowAgentPort;
      const threadId = ThreadId.make("thread-two-turns");
      const first = baseDispatch("two-1", threadId);
      const second = baseDispatch("two-2", threadId);

      const firstStarted = yield* port.ensureStarted(first);
      const secondStarted = yield* port.ensureStarted(second);
      fake.control.completeTurn({
        messageId: firstStarted.messageId,
        text: 'older\n```json\n{"turn":1}\n```',
      });
      fake.control.completeTurn({
        messageId: secondStarted.messageId,
        text: 'newer\n```json\n{"turn":2}\n```',
      });

      const firstOutput = yield* port.readCapturedOutput({
        stepRunId: first.stepRunId,
        threadId,
        messageId: firstStarted.messageId,
      });
      const secondOutput = yield* port.readCapturedOutput({
        stepRunId: second.stepRunId,
        threadId,
        messageId: secondStarted.messageId,
      });

      assert.deepEqual(firstOutput, { turn: 1 });
      assert.deepEqual(secondOutput, { turn: 2 });
    }),
  );
});

portIt.effect(
  "approval and user-input parity paths return awaitingUser and respond correctly",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return runWithFake(
      fake,
      Effect.gen(function* () {
        const port = yield* WorkflowAgentPort;
        const req = baseDispatch("pending");
        const started = yield* port.ensureStarted(req);
        fake.control.appendActivity({
          threadId: req.threadId,
          kind: "approval.requested",
          payload: { requestId: "approval-1" },
        });

        const approval = yield* port.awaitTerminal(req.dispatchId, req.threadId);
        assert.deepEqual(approval, {
          ok: false,
          awaitingUser: true,
          waitingReason: "Provider is waiting for user input",
          providerThreadId: req.threadId,
          providerRequestId: ApprovalRequestId.make("approval-1"),
          providerResponseKind: "request",
        });
        yield* port.respond({
          threadId: req.threadId,
          requestId: ApprovalRequestId.make("approval-1"),
          responseKind: "request",
          approved: true,
        });
        fake.control.appendActivity({
          threadId: req.threadId,
          kind: "approval.resolved",
          payload: { requestId: "approval-1", decision: "accept" },
          createdAt: "2026-07-03T00:00:01.000Z",
        });
        fake.control.appendActivity({
          threadId: req.threadId,
          kind: "user-input.requested",
          payload: {
            requestId: "input-1",
            questions: [{ id: "answer", question: "What now?" }],
          },
          createdAt: "2026-07-03T00:00:02.000Z",
        });

        const userInput = yield* port.awaitTerminal(req.dispatchId, req.threadId);
        assert.deepEqual(userInput, {
          ok: false,
          awaitingUser: true,
          waitingReason: "What now?",
          providerThreadId: req.threadId,
          providerRequestId: ApprovalRequestId.make("input-1"),
          providerResponseKind: "user-input",
          providerQuestionId: "answer",
        });
        yield* port.respond({
          threadId: req.threadId,
          requestId: ApprovalRequestId.make("input-1"),
          responseKind: "user-input",
          approved: true,
          questionId: "answer",
          text: "Continue",
        });

        assert.deepEqual(fake.control.approvalResponses(), [
          { threadId: req.threadId, requestId: "approval-1", decision: "accept" },
        ]);
        assert.deepEqual(fake.control.userInputResponses(), [
          { threadId: req.threadId, requestId: "input-1", answers: { answer: "Continue" } },
        ]);
        assert.equal(fake.control.turnByMessageId(started.messageId)?.state, "running");
      }),
    );
  },
);

portIt.effect("stranded running turn stays running while plugin dispatch advances", () => {
  const fake = makeWorkflowAgentPortFake();
  return runWithFake(
    fake,
    Effect.gen(function* () {
      const port = yield* WorkflowAgentPort;
      const sql = yield* SqlClient.SqlClient;
      const req = baseDispatch("stranded");
      const boardId = BoardId.make("board-stranded");
      const messageId = MessageId.make("message-stranded");
      yield* seedBoardAndTicket(sql, { boardId, ticketId: req.ticketId });
      fake.control.seedStartedTurn({
        threadId: req.threadId,
        messageId,
        state: "running",
      });
      yield* insertOutbox(sql, { ...req, messageId, status: "start_requested" });

      yield* port.recoverPending();
      const row = yield* readOutbox(sql, req.dispatchId);

      assert.equal(row?.status, "abandoned");
      assert.equal(fake.control.turnByMessageId(messageId)?.state, "running");
      assert.deepEqual(fake.control.interruptCalls(), [req.threadId]);
      assert.deepEqual(fake.control.stopCalls(), [req.threadId]);
    }),
  );
});
