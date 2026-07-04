// @effect-diagnostics globalTimers:off preferSchemaOverJson:off
import { MessageId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { WorkflowRpcError } from "../../../contracts/workflow.ts";
import { TestSql } from "../testHarness.ts";
import { ApprovalGateLive } from "./ApprovalGate.ts";
import { BoardRegistryLive } from "./BoardRegistry.ts";
import { DurableApprovalResumeLive } from "./DurableApprovalResume.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { WorkflowBoardSaveLocksLive } from "./WorkflowBoardSaveLocks.ts";
import { WorkflowEngineLayer } from "./WorkflowEngine.ts";
import { WorkflowEventCommitterLive } from "./WorkflowEventCommitter.ts";
import { WorkflowRecoveryLive } from "./WorkflowRecovery.ts";
import { WorkflowRoutingContextBuilderLive } from "./WorkflowRoutingContextBuilder.ts";
import { WorkflowIds } from "../Services/WorkflowIds.ts";
import { DurableApprovalResume } from "../Services/DurableApprovalResume.ts";
import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { GitHubPort, type GitHubPortShape } from "../Services/GitHubPort.ts";
import { ProjectWorkspaceResolver } from "../Services/ProjectWorkspaceResolver.ts";
import { ScriptCancelRegistry } from "../Services/ScriptCancelRegistry.ts";
import { StepExecutor } from "../Services/StepExecutor.ts";
import { WorkflowAgentPort } from "../Services/WorkflowAgentPort.ts";
import { WorkflowBoardVersionStore } from "../Services/WorkflowBoardVersionStore.ts";
import { WorkflowEngine, type RecoveredStepResult } from "../Services/WorkflowEngine.ts";
import { WorkflowEventStore } from "../Services/WorkflowEventStore.ts";
import { WorkflowFileLoader, WorkflowFilePort } from "../Services/WorkflowFileLoader.ts";
import { WorkflowReadModel, type TicketDetail } from "../Services/WorkflowReadModel.ts";
import { WorkflowRecovery } from "../Services/WorkflowRecovery.ts";
import { WorktreeLeaseService } from "../Services/WorktreeLeaseService.ts";
import {
  makeWorkflowAgentPortFake,
  type WorkflowAgentPortFake,
} from "../WorkflowAgentPort.fake.ts";
import { WorkflowFoundationLive } from "../WorkflowFoundationLive.ts";
import { WorkflowAgentPortLive } from "./WorkflowAgentPort.ts";
import { DeterministicWorkflowIds } from "./WorkflowIds.ts";

const insertAwaitingEvent = (input: {
  readonly eventId: string;
  readonly ticketId: string;
  readonly stepRunId: string;
  readonly provider?: boolean;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO p_workflow_boards_events (
        event_id,
        ticket_id,
        stream_version,
        event_type,
        occurred_at,
        payload_json
      ) VALUES (
        ${input.eventId},
        ${input.ticketId},
        1,
        'StepAwaitingUser',
        '2026-07-03T00:00:00.000Z',
        ${JSON.stringify({
          stepRunId: input.stepRunId,
          waitingReason: "waiting",
          ...(input.provider
            ? {
                providerThreadId: "thread-provider",
                providerRequestId: "request-provider",
                providerResponseKind: "request",
              }
            : {}),
        })}
      )
    `;
  });

const insertDispatch = (input: {
  readonly dispatchId: string;
  readonly ticketId: string;
  readonly stepRunId: string;
  readonly status: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO p_workflow_boards_dispatch_outbox (
        dispatch_id,
        ticket_id,
        step_run_id,
        thread_id,
        provider_instance,
        model,
        instruction,
        worktree_path,
        status,
        created_at,
        message_id
      ) VALUES (
        ${input.dispatchId},
        ${input.ticketId},
        ${input.stepRunId},
        'thread-provider',
        'codex',
        'model',
        'instruction',
        '/tmp/worktree',
        ${input.status},
        '2026-07-03T00:00:00.000Z',
        'message-provider'
      )
    `;
  });

const readDispatchStatus = (dispatchId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly status: string }>`
      SELECT status
      FROM p_workflow_boards_dispatch_outbox
      WHERE dispatch_id = ${dispatchId}
    `;
    return rows[0]?.status ?? null;
  });

const durableApprovalLayer = it.layer(
  DurableApprovalResumeLive.pipe(Layer.provideMerge(ApprovalGateLive), Layer.provideMerge(TestSql)),
);

durableApprovalLayer("DurableApprovalResume", (it) => {
  it.effect("leaves provider-backed dispatch rows for WorkflowAgentPort recovery", () =>
    Effect.gen(function* () {
      yield* insertAwaitingEvent({
        eventId: "evt-provider-wait",
        ticketId: "ticket-provider",
        stepRunId: "step-provider",
        provider: true,
      });
      yield* insertDispatch({
        dispatchId: "dispatch-provider",
        ticketId: "ticket-provider",
        stepRunId: "step-provider",
        status: "projected",
      });

      const resume = yield* DurableApprovalResume;
      yield* resume.resume();

      assert.equal(yield* readDispatchStatus("dispatch-provider"), "projected");
    }),
  );

  it.effect("parks literal human approval waits without dispatch metadata", () =>
    Effect.gen(function* () {
      yield* insertAwaitingEvent({
        eventId: "evt-human-wait",
        ticketId: "ticket-human",
        stepRunId: "step-human",
      });

      const resume = yield* DurableApprovalResume;
      yield* resume.resume();
      assert.ok(true);
    }),
  );
});

const completedRecoveredSteps: Array<{
  readonly stepRunId: string;
  readonly result: RecoveredStepResult;
  readonly captureTurn?: unknown;
}> = [];

const recoveredBoardWip: string[] = [];
const loadedRecoveryBoards: string[] = [];
const recoveryReadFiles: string[] = [];
const recoveryMissingWorkflowFiles = new Set<string>();

let recoveryEventId = 0;

const missingWorkflowFileError = () =>
  new WorkflowRpcError({
    message: "workflow file read failed",
    cause: { reason: { _tag: "NotFound" } },
  });

const RecoveryIdsLayer = Layer.succeed(WorkflowIds, {
  ticketId: () => Effect.succeed("ticket-unused" as never),
  pipelineRunId: () => Effect.succeed("pipeline-unused" as never),
  scriptRunId: () => Effect.succeed("script-unused" as never),
  stepRunId: () => Effect.succeed("step-unused" as never),
  messageId: () => Effect.succeed("message-unused" as never),
  eventId: () =>
    Effect.sync(() => {
      recoveryEventId += 1;
      return `evt-recovery-${recoveryEventId}` as never;
    }),
  token: () => Effect.succeed("token-unused" as never),
  mappingId: () => Effect.succeed("mapping-unused"),
});

const RecoveryEngineLayer = Layer.succeed(WorkflowEngine, {
  createTicket: () => Effect.die("unused createTicket"),
  editTicket: () => Effect.void,
  moveTicket: () => Effect.die("unused moveTicket"),
  createTicketAndEnterUnlocked: () => Effect.die("unused createTicketAndEnterUnlocked"),
  closeTicketFromSourceUnlocked: () => Effect.die("unused closeTicketFromSourceUnlocked"),
  reopenTicketFromSourceUnlocked: () => Effect.die("unused reopenTicketFromSourceUnlocked"),
  cancellableProviderTurnsForTicket: () => Effect.die("unused cancellableProviderTurnsForTicket"),
  supersedeProviderWorkForTicket: () => Effect.die("unused supersedeProviderWorkForTicket"),
  terminalAgentSessionThreadsForTicket: () =>
    Effect.die("unused terminalAgentSessionThreadsForTicket"),
  stopAgentSessionsForTicket: () => Effect.die("unused stopAgentSessionsForTicket"),
  editTicketFieldsUnlocked: () => Effect.die("unused editTicketFieldsUnlocked"),
  withBoardAdmissionLock: (_boardId, effect) => effect,
  runLane: () => Effect.die("unused runLane"),
  ingestExternalEvent: () => Effect.succeed({ outcome: "noop" as const }),
  resolveApproval: () => Effect.die("unused resolveApproval"),
  answerTicketStep: () => Effect.void,
  postTicketMessage: () => Effect.void,
  editTicketMessage: () => Effect.void,
  cancelStep: () => Effect.die("unused cancelStep"),
  cancelBoardPipelines: () => Effect.void,
  cancelTicketPipelines: () => Effect.void,
  recoverBoardWip: (boardId) =>
    Effect.sync(() => {
      recoveredBoardWip.push(boardId as string);
    }),
  completeRecoveredStep: (stepRunId, result, captureTurn) =>
    Effect.sync(() => {
      completedRecoveredSteps.push({
        stepRunId,
        result,
        ...(captureTurn === undefined ? {} : { captureTurn }),
      });
    }),
} satisfies WorkflowEngine["Service"]);

const RecoveryAgentPortLayer = Layer.succeed(WorkflowAgentPort, {
  ensureStarted: () => Effect.succeed({ messageId: "message-unused" as never }),
  awaitTerminal: () => Effect.succeed({ ok: true as const }),
  awaitStepTerminal: () => Effect.succeed({ ok: true as const }),
  getDispatchForStep: () => Effect.succeed(null),
  confirmStep: () => Effect.void,
  readCapturedOutput: () => Effect.void,
  respond: () => Effect.void,
  isPendingRequestLive: () => Effect.succeed(true),
  cleanupSession: () => Effect.void,
  recoverPending: () => Effect.void,
} satisfies WorkflowAgentPort["Service"]);

const RecoveryVersionStoreLayer = Layer.succeed(WorkflowBoardVersionStore, {
  record: () => Effect.void,
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(null),
  deleteForBoard: () => Effect.void,
} satisfies WorkflowBoardVersionStore["Service"]);

const RecoveryFilePortLayer = Layer.succeed(WorkflowFilePort, {
  readFileString: (filePath) =>
    Effect.sync(() => {
      recoveryReadFiles.push(filePath);
      return filePath;
    }).pipe(
      Effect.flatMap((filePath) =>
        recoveryMissingWorkflowFiles.has(filePath)
          ? Effect.fail(missingWorkflowFileError())
          : Effect.succeed("{}"),
      ),
    ),
  instructionFileExists: () => Effect.succeed(true),
} satisfies WorkflowFilePort["Service"]);

const RecoveryFileLoaderLayer = Layer.succeed(WorkflowFileLoader, {
  lintDefinition: () => Effect.succeed([]),
  loadAndRegister: (input) =>
    Effect.sync(() => {
      loadedRecoveryBoards.push(input.boardId as string);
      return input.boardId;
    }),
} satisfies WorkflowFileLoader["Service"]);

const RecoveryProjectWorkspaceResolverLayer = Layer.succeed(ProjectWorkspaceResolver, {
  resolve: (projectId) => Effect.succeed(`/workspace/${String(projectId)}`),
} satisfies ProjectWorkspaceResolver["Service"]);

const scriptCancelNoop = Layer.succeed(ScriptCancelRegistry, {
  register: () => Effect.void,
  unregister: () => Effect.void,
  cancel: () => Effect.void,
});

const noOpStepExecutor = Layer.succeed(StepExecutor, {
  execute: () => Effect.succeed({ _tag: "completed" as const }),
} satisfies StepExecutor["Service"]);

const workflowAgentPortLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowAgentPortLive.pipe(Layer.provideMerge(fake.layer), Layer.provideMerge(TestSql));

const realEngineLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowEngineLayer.pipe(
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(noOpStepExecutor),
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

const realRecoveryLayer = (fake: WorkflowAgentPortFake) =>
  WorkflowRecoveryLive.pipe(
    Layer.provideMerge(DurableApprovalResumeLive),
    Layer.provideMerge(RecoveryWorktreeLeaseLayer),
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(realEngineLayer(fake)),
    Layer.provideMerge(ApprovalGateLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(scriptCancelNoop),
    Layer.provideMerge(WorkflowRoutingContextBuilderLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(RecoveryVersionStoreLayer),
    Layer.provideMerge(RecoveryFilePortLayer),
    Layer.provideMerge(RecoveryFileLoaderLayer),
    Layer.provideMerge(RecoveryProjectWorkspaceResolverLayer),
  ).pipe(
    Layer.provideMerge(RecoveryGitHubPortLayer),
    Layer.provideMerge(workflowAgentPortLayer(fake)),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(DeterministicWorkflowIds),
    Layer.provideMerge(ProjectionProjectsTableLive),
    Layer.provideMerge(TestSql),
  );

const RecoveryWorktreeLeaseLayer = Layer.effect(
  WorktreeLeaseService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      acquire: () => Effect.succeed({ fenceToken: 1 }),
      release: (worktreeRef, fenceToken) =>
        sql`
          UPDATE p_workflow_boards_worktree_lease
          SET owner_kind = 'released'
          WHERE worktree_ref = ${worktreeRef}
            AND fence_token = ${fenceToken}
        `.pipe(Effect.asVoid, Effect.orDie),
      isValid: () => Effect.succeed(true),
    } satisfies WorktreeLeaseService["Service"];
  }),
);

const ProjectionProjectsTableLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS projection_projects (
        project_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        scripts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  }),
);

const gitHubPortScript: {
  findPrForBranch: { number: number; url: string } | null;
  prDetailState: "open" | "merged" | "closed";
  findPrForBranchCalls: number;
} = {
  findPrForBranch: null,
  prDetailState: "open",
  findPrForBranchCalls: 0,
};

const RecoveryGitHubPortLayer = Layer.succeed(GitHubPort, {
  preflight: () => Effect.succeed({ ok: true as const }),
  resolveRemote: () => Effect.succeed({ remoteName: "origin", repo: "acme/widgets" }),
  defaultBranch: () => Effect.succeed("main"),
  openPr: () => Effect.die("unused openPr"),
  findPrForBranch: () =>
    Effect.sync(() => {
      gitHubPortScript.findPrForBranchCalls += 1;
      return gitHubPortScript.findPrForBranch;
    }),
  prDetail: (input: { prNumber: number }) =>
    Effect.succeed({
      number: input.prNumber,
      url: `https://github.com/acme/widgets/pull/${input.prNumber}`,
      state: gitHubPortScript.prDetailState,
      headSha: null,
      reviewDecision: "none" as const,
      ciState: "success" as const,
    }),
  mergePr: () => Effect.die("unused mergePr"),
  failingCheckLogs: () => Effect.succeed(null),
  listReviewFeedback: () => Effect.succeed([]),
} satisfies GitHubPortShape);

const recoveryLayer = it.layer(
  WorkflowRecoveryLive.pipe(
    Layer.provideMerge(DurableApprovalResumeLive),
    Layer.provideMerge(RecoveryWorktreeLeaseLayer),
    Layer.provideMerge(WorkflowEventCommitterLive),
    Layer.provideMerge(RecoveryEngineLayer),
    Layer.provideMerge(RecoveryIdsLayer),
    Layer.provideMerge(ApprovalGateLive),
    Layer.provideMerge(BoardRegistryLive),
    Layer.provideMerge(PredicateEvaluatorLive),
    Layer.provideMerge(WorkflowBoardSaveLocksLive),
    Layer.provideMerge(RecoveryVersionStoreLayer),
    Layer.provideMerge(RecoveryFilePortLayer),
    Layer.provideMerge(RecoveryFileLoaderLayer),
    Layer.provideMerge(RecoveryProjectWorkspaceResolverLayer),
    Layer.provideMerge(RecoveryGitHubPortLayer),
    Layer.provideMerge(RecoveryAgentPortLayer),
    Layer.provideMerge(WorkflowFoundationLive),
    Layer.provideMerge(ProjectionProjectsTableLive),
    Layer.provideMerge(TestSql),
  ),
);

const resetRecoveryState = () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM p_workflow_boards_dispatch_outbox`;
    yield* sql`DELETE FROM p_workflow_boards_worktree_lease`;
    yield* sql`DELETE FROM p_workflow_boards_script_run`;
    yield* sql`DELETE FROM p_workflow_boards_pr_state`;
    yield* sql`DELETE FROM p_workflow_boards_projection_step_run`;
    yield* sql`DELETE FROM p_workflow_boards_projection_pipeline_run`;
    yield* sql`DELETE FROM p_workflow_boards_projection_ticket`;
    yield* sql`DELETE FROM p_workflow_boards_projection_board`;
    yield* sql`DELETE FROM p_workflow_boards_events`;
    yield* sql`DELETE FROM projection_projects`;
    completedRecoveredSteps.length = 0;
    recoveredBoardWip.length = 0;
    loadedRecoveryBoards.length = 0;
    recoveryReadFiles.length = 0;
    recoveryMissingWorkflowFiles.clear();
    recoveryEventId = 0;
    gitHubPortScript.findPrForBranch = null;
    gitHubPortScript.prDetailState = "open";
    gitHubPortScript.findPrForBranchCalls = 0;
  });

const workflowEventCount = (ticketId: string, eventType: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM p_workflow_boards_events
      WHERE ticket_id = ${ticketId}
        AND event_type = ${eventType}
    `;
    return rows[0]?.count ?? 0;
  });

const awaitTicketWhere = (ticketId: string, predicate: (detail: TicketDetail | null) => boolean) =>
  Effect.gen(function* () {
    const read = yield* WorkflowReadModel;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = yield* read.getTicketDetail(ticketId as never);
      if (predicate(detail)) {
        return detail;
      }
      yield* Effect.sleep("10 millis");
      yield* Effect.yieldNow;
    }
    return yield* read.getTicketDetail(ticketId as never);
  });

const recoveryCompletionDefinition = {
  name: "terminal recovery",
  settings: { maxConcurrentTickets: 1 },
  lanes: [
    {
      key: "impl",
      name: "Impl",
      entry: "auto",
      wipLimit: 1,
      pipeline: [
        {
          key: "code",
          type: "agent",
          agent: { instance: "codex", model: "gpt-5.5" },
          instruction: "implement",
        },
      ],
      on: { success: "done", failure: "needs" },
    },
    { key: "needs", name: "Needs", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
};

const seedRunningAgentPipeline = (input: {
  readonly boardId: string;
  readonly projectId: string;
  readonly ticketId: string;
  readonly pipelineRunId: string;
  readonly stepRunId: string;
  readonly laneEntryToken: string;
}) =>
  Effect.gen(function* () {
    const registry = yield* BoardRegistry;
    const read = yield* WorkflowReadModel;
    const sql = yield* SqlClient.SqlClient;
    yield* registry.register(input.boardId as never, recoveryCompletionDefinition);
    yield* read.registerBoard({
      boardId: input.boardId as never,
      projectId: input.projectId as never,
      name: "Terminal recovery",
      workflowFilePath: ".t3/boards/terminal-recovery.json",
      workflowVersionHash: `hash-${input.boardId}`,
      maxConcurrentTickets: 1,
    });
    yield* sql`
      INSERT INTO p_workflow_boards_events (
        event_id, ticket_id, stream_version, event_type, occurred_at, payload_json
      )
      VALUES
        (
          ${`${input.ticketId}-created`},
          ${input.ticketId},
          1,
          'TicketCreated',
          '2026-07-03T00:00:00.000Z',
          ${JSON.stringify({
            boardId: input.boardId,
            title: input.ticketId,
            laneKey: "impl",
          })}
        ),
        (
          ${`${input.ticketId}-moved`},
          ${input.ticketId},
          2,
          'TicketMovedToLane',
          '2026-07-03T00:00:01.000Z',
          ${JSON.stringify({
            toLane: "impl",
            laneEntryToken: input.laneEntryToken,
            reason: "initial",
          })}
        ),
        (
          ${`${input.ticketId}-pipeline-started`},
          ${input.ticketId},
          3,
          'PipelineStarted',
          '2026-07-03T00:00:02.000Z',
          ${JSON.stringify({
            pipelineRunId: input.pipelineRunId,
            laneKey: "impl",
            laneEntryToken: input.laneEntryToken,
          })}
        ),
        (
          ${`${input.ticketId}-step-started`},
          ${input.ticketId},
          4,
          'StepStarted',
          '2026-07-03T00:00:03.000Z',
          ${JSON.stringify({
            pipelineRunId: input.pipelineRunId,
            stepRunId: input.stepRunId,
            stepKey: "code",
            stepType: "agent",
          })}
        )
    `;
    yield* sql`
      INSERT INTO p_workflow_boards_projection_ticket (
        ticket_id,
        board_id,
        title,
        current_lane_key,
        status,
        created_at,
        updated_at,
        current_lane_entry_token,
        current_lane_entered_at
      )
      VALUES (
        ${input.ticketId},
        ${input.boardId},
        ${input.ticketId},
        'impl',
        'running',
        '2026-07-03T00:00:00.000Z',
        '2026-07-03T00:00:03.000Z',
        ${input.laneEntryToken},
        '2026-07-03T00:00:01.000Z'
      )
    `;
    yield* sql`
      INSERT INTO p_workflow_boards_projection_pipeline_run (
        pipeline_run_id,
        ticket_id,
        lane_key,
        lane_entry_token,
        status,
        started_at
      )
      VALUES (
        ${input.pipelineRunId},
        ${input.ticketId},
        'impl',
        ${input.laneEntryToken},
        'running',
        '2026-07-03T00:00:02.000Z'
      )
    `;
    yield* sql`
      INSERT INTO p_workflow_boards_projection_step_run (
        step_run_id,
        pipeline_run_id,
        ticket_id,
        step_key,
        step_type,
        status,
        started_at
      )
      VALUES (
        ${input.stepRunId},
        ${input.pipelineRunId},
        ${input.ticketId},
        'code',
        'agent',
        'running',
        '2026-07-03T00:00:03.000Z'
      )
    `;
  });

it.effect(
  "completes a running step whose start_requested dispatch terminalized during recoverPending",
  () => {
    const fake = makeWorkflowAgentPortFake();
    return Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;
      const read = yield* WorkflowReadModel;

      yield* seedRunningAgentPipeline({
        boardId: "board-terminalized-recovery",
        projectId: "project-terminalized-recovery",
        ticketId: "ticket-terminalized-recovery",
        pipelineRunId: "pipeline-terminalized-recovery",
        stepRunId: "step-terminalized-recovery",
        laneEntryToken: "token-terminalized-recovery",
      });
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
        VALUES (
          'dispatch-terminalized-recovery',
          'ticket-terminalized-recovery',
          'step-terminalized-recovery',
          'thread-terminalized-recovery',
          'message-terminalized-recovery',
          'codex',
          'gpt-5.5',
          'implement',
          '/tmp/terminalized-recovery',
          'start_requested',
          '2026-07-03T00:00:04.000Z',
          '2026-07-03T00:00:04.000Z'
        )
      `;
      fake.control.seedStartedTurn({
        threadId: ThreadId.make("thread-terminalized-recovery"),
        messageId: MessageId.make("message-terminalized-recovery"),
        state: "completed",
      });

      yield* recovery.recover();

      const detail = yield* awaitTicketWhere(
        "ticket-terminalized-recovery",
        (detail) => detail?.ticket.currentLaneKey === "done",
      );
      assert.equal(detail?.ticket.currentLaneKey, "done");
      assert.equal(detail?.steps[0]?.status, "completed");
      assert.equal(
        yield* read.countAdmittedInLane("board-terminalized-recovery" as never, "impl" as never),
        0,
      );
      const outbox = yield* sql<{ readonly status: string }>`
        SELECT status
        FROM p_workflow_boards_dispatch_outbox
        WHERE dispatch_id = 'dispatch-terminalized-recovery'
      `;
      assert.equal(outbox[0]?.status, "terminal");
      assert.equal(yield* workflowEventCount("ticket-terminalized-recovery", "StepCompleted"), 1);
      assert.equal(
        yield* workflowEventCount("ticket-terminalized-recovery", "PipelineCompleted"),
        1,
      );

      yield* recovery.recover();
      assert.equal(yield* workflowEventCount("ticket-terminalized-recovery", "StepCompleted"), 1);
      assert.equal(
        yield* workflowEventCount("ticket-terminalized-recovery", "PipelineCompleted"),
        1,
      );
    }).pipe(Effect.provide(realRecoveryLayer(fake)));
  },
);

it.effect("resumes stranded terminal pipelines once and keeps recovery idempotent", () => {
  const fake = makeWorkflowAgentPortFake();
  return Effect.gen(function* () {
    yield* resetRecoveryState();
    const recovery = yield* WorkflowRecovery;

    yield* seedRunningAgentPipeline({
      boardId: "board-stranded-pipeline",
      projectId: "project-stranded-pipeline",
      ticketId: "ticket-stranded-pipeline",
      pipelineRunId: "pipeline-stranded-pipeline",
      stepRunId: "step-stranded-pipeline",
      laneEntryToken: "token-stranded-pipeline",
    });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO p_workflow_boards_events (
        event_id, ticket_id, stream_version, event_type, occurred_at, payload_json
      )
      VALUES (
        'evt-stranded-step-completed',
        'ticket-stranded-pipeline',
        5,
        'StepCompleted',
        '2026-07-03T00:00:04.000Z',
        '{"stepRunId":"step-stranded-pipeline","output":{"ok":true}}'
      )
    `;
    yield* sql`
      UPDATE p_workflow_boards_projection_step_run
      SET status = 'completed',
          output_json = '{"ok":true}',
          finished_at = '2026-07-03T00:00:04.000Z'
      WHERE step_run_id = 'step-stranded-pipeline'
    `;

    yield* recovery.recover();

    const detail = yield* awaitTicketWhere(
      "ticket-stranded-pipeline",
      (detail) => detail?.ticket.currentLaneKey === "done",
    );
    assert.equal(detail?.ticket.currentLaneKey, "done");
    assert.deepEqual(detail?.steps[0]?.output, { ok: true });
    assert.equal(yield* workflowEventCount("ticket-stranded-pipeline", "StepCompleted"), 1);
    assert.equal(yield* workflowEventCount("ticket-stranded-pipeline", "PipelineCompleted"), 1);

    yield* recovery.recover();
    assert.equal(yield* workflowEventCount("ticket-stranded-pipeline", "StepCompleted"), 1);
    assert.equal(yield* workflowEventCount("ticket-stranded-pipeline", "PipelineCompleted"), 1);
  }).pipe(Effect.provide(realRecoveryLayer(fake)));
});

recoveryLayer("WorkflowRecovery", (it) => {
  it.effect("preloads persisted boards through the filesystem capability", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const recovery = yield* WorkflowRecovery;
      const read = yield* WorkflowReadModel;

      yield* read.registerBoard({
        boardId: "board-preload" as never,
        projectId: "project-preload" as never,
        name: "Preload",
        workflowFilePath: ".t3/boards/preload.json",
        workflowVersionHash: "hash-preload",
        maxConcurrentTickets: 1,
      });

      yield* recovery.recover();

      assert.deepEqual(recoveryReadFiles, ["/workspace/project-preload/.t3/boards/preload.json"]);
      assert.deepEqual(loadedRecoveryBoards, ["board-preload"]);
      assert.deepEqual(recoveredBoardWip, ["board-preload"]);
    }),
  );

  it.effect("cascades missing workflow files without resurrecting the board", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const recovery = yield* WorkflowRecovery;
      const read = yield* WorkflowReadModel;
      const missingPath = "/workspace/project-missing/.t3/boards/missing.json";

      recoveryMissingWorkflowFiles.add(missingPath);
      yield* read.registerBoard({
        boardId: "board-missing" as never,
        projectId: "project-missing" as never,
        name: "Missing",
        workflowFilePath: ".t3/boards/missing.json",
        workflowVersionHash: "hash-missing",
        maxConcurrentTickets: 1,
      });

      yield* recovery.recover();

      assert.deepEqual(recoveryReadFiles, [missingPath]);
      assert.deepEqual(loadedRecoveryBoards, []);
      assert.deepEqual(recoveredBoardWip, []);
      assert.equal(yield* read.getBoard("board-missing" as never), null);

      yield* recovery.recover();
      assert.equal(yield* read.getBoard("board-missing" as never), null);
      assert.deepEqual(loadedRecoveryBoards, []);
      assert.deepEqual(recoveredBoardWip, []);
    }),
  );

  it.effect("releases worktree leases for steps that ended blocked", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;

      yield* sql`
        INSERT INTO p_workflow_boards_events (
          event_id,
          ticket_id,
          stream_version,
          event_type,
          occurred_at,
          payload_json
        )
        VALUES (
          'evt-step-blocked',
          'ticket-blocked',
          0,
          'StepBlocked',
          '2026-06-07T00:00:00.000Z',
          '{"stepRunId":"step-run-blocked","reason":"Project not trusted to run scripts"}'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_worktree_lease (
          worktree_ref,
          owner_kind,
          owner_id,
          fence_token,
          acquired_at,
          expires_at
        )
        VALUES (
          'wt-blocked',
          'step',
          'step-run-blocked',
          7,
          '2026-06-07T00:00:00.000Z',
          '2026-06-07T00:30:00.000Z'
        )
      `;

      yield* recovery.recover();

      const rows = yield* sql<{ readonly ownerKind: string }>`
        SELECT owner_kind AS "ownerKind"
        FROM p_workflow_boards_worktree_lease
        WHERE worktree_ref = 'wt-blocked'
      `;
      assert.equal(rows[0]?.ownerKind, "released");
    }),
  );

  it.effect("recovers an already-terminal merge step with its stored outcome", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;
      const registry = yield* BoardRegistry;

      yield* registry.register("board-script-restart" as never, {
        name: "script restart",
        lanes: [{ key: "impl", name: "Impl", entry: "manual" }],
      });
      yield* sql`
        INSERT INTO p_workflow_boards_projection_board (
          board_id,
          project_id,
          name,
          workflow_file_path,
          workflow_version_hash,
          max_concurrent_tickets
        )
        VALUES (
          'board-script-restart',
          'project-script-restart',
          'Script Restart',
          '.t3/boards/script-restart.json',
          'hash-script-restart',
          1
        )
      `;
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
        VALUES (
          'ticket-script-restart',
          'board-script-restart',
          'Script restart',
          'impl',
          'running',
          '2026-07-03T00:00:00.000Z',
          '2026-07-03T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_pipeline_run (
          pipeline_run_id,
          ticket_id,
          lane_key,
          lane_entry_token,
          status,
          started_at
        )
        VALUES (
          'pipeline-script-restart',
          'ticket-script-restart',
          'impl',
          'token-script-restart',
          'running',
          '2026-07-03T00:00:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO p_workflow_boards_projection_step_run (
          step_run_id,
          pipeline_run_id,
          ticket_id,
          step_key,
          step_type,
          status,
          started_at
        )
        VALUES (
          'step-run-merge-terminal',
          'pipeline-merge-terminal',
          'ticket-merge-terminal',
          'land',
          'merge',
          'running',
          '2026-06-07T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_events (
          event_id,
          ticket_id,
          stream_version,
          event_type,
          occurred_at,
          payload_json
        )
        VALUES (
          'evt-merge-terminal-completed',
          'ticket-merge-terminal',
          0,
          'StepCompleted',
          '2026-06-07T00:00:01.000Z',
          '{"stepRunId":"step-run-merge-terminal","output":{"merged":true}}'
        )
      `;

      yield* recovery.recover();

      assert.deepEqual(completedRecoveredSteps, [
        {
          stepRunId: "step-run-merge-terminal",
          result: { _tag: "completed", output: { merged: true } },
        },
      ]);
    }),
  );

  const prBoardDefinition = {
    name: "pr recovery",
    lanes: [
      {
        key: "ship",
        name: "Ship",
        entry: "auto",
        pipeline: [
          { key: "open-pr", type: "pullRequest", action: "open" },
          { key: "land-pr", type: "pullRequest", action: "land" },
        ],
      },
    ],
  };

  const seedPrStep = (input: {
    readonly boardId: string;
    readonly ticketId: string;
    readonly stepRunId: string;
    readonly stepKey: string;
  }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const registry = yield* BoardRegistry;
      yield* registry.register(input.boardId as never, prBoardDefinition);
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        )
        VALUES (
          ${`${input.boardId}-project`}, 'PR repo', '/tmp/pr-repo', '{}',
          '2026-06-07T00:00:00.000Z', '2026-06-07T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_board (
          board_id, project_id, name, workflow_file_path,
          workflow_version_hash, max_concurrent_tickets
        )
        VALUES (
          ${input.boardId}, ${`${input.boardId}-project`}, 'PR recovery',
          '.t3/boards/pr.json', ${`hash-${input.boardId}`}, 1
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_ticket (
          ticket_id, board_id, title, current_lane_key, status, created_at, updated_at
        )
        VALUES (
          ${input.ticketId}, ${input.boardId}, 'PR ticket', 'ship', 'running',
          '2026-06-07T00:00:00.000Z', '2026-06-07T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_step_run (
          step_run_id, pipeline_run_id, ticket_id, step_key, step_type, status, started_at
        )
        VALUES (
          ${input.stepRunId}, ${`${input.stepRunId}-pipeline`}, ${input.ticketId},
          ${input.stepKey}, 'pullRequest', 'running', '2026-06-07T00:00:00.000Z'
        )
      `;
    });

  const seedPrStateRow = (ticketId: string, prNumber: number) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO p_workflow_boards_pr_state (
          ticket_id, pr_number, pr_url, branch, remote_name, repo, pr_state, updated_at
        )
        VALUES (
          ${ticketId}, ${prNumber}, ${`https://github.com/acme/widgets/pull/${prNumber}`},
          ${`workflow/${ticketId}`}, 'origin', 'acme/widgets', 'open', '2026-06-07T00:00:02.000Z'
        )
      `;
    });

  it.effect("recovers an open PR step from recorded PR state without adopting", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-open-recorded",
        ticketId: "ticket-pr-open-recorded",
        stepRunId: "step-run-pr-open-recorded",
        stepKey: "open-pr",
      });
      yield* seedPrStateRow("ticket-pr-open-recorded", 42);

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-open-recorded",
      );
      assert.deepEqual(calls, [
        {
          stepRunId: "step-run-pr-open-recorded",
          result: {
            _tag: "completed",
            output: { prNumber: 42, url: "https://github.com/acme/widgets/pull/42" },
          },
        },
      ]);
      assert.equal(gitHubPortScript.findPrForBranchCalls, 0);
      const events = yield* Stream.runCollect(
        (yield* WorkflowEventStore).readByTicket("ticket-pr-open-recorded" as never),
      );
      assert.equal(Array.from(events).filter((event) => event.type === "TicketPrOpened").length, 0);
    }),
  );

  it.effect("adopts a created-but-unrecorded PR and commits TicketPrOpened", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      gitHubPortScript.findPrForBranch = {
        number: 77,
        url: "https://github.com/acme/widgets/pull/77",
      };
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-open-adopt",
        ticketId: "ticket-pr-open-adopt",
        stepRunId: "step-run-pr-open-adopt",
        stepKey: "open-pr",
      });

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-open-adopt",
      );
      assert.deepEqual(calls, [
        {
          stepRunId: "step-run-pr-open-adopt",
          result: {
            _tag: "completed",
            output: { prNumber: 77, url: "https://github.com/acme/widgets/pull/77" },
          },
        },
      ]);
      assert.isAtLeast(gitHubPortScript.findPrForBranchCalls, 1);
      const events = yield* Stream.runCollect(
        (yield* WorkflowEventStore).readByTicket("ticket-pr-open-adopt" as never),
      );
      const opened = Array.from(events).filter((event) => event.type === "TicketPrOpened");
      assert.equal(opened.length, 1);
      assert.equal((opened[0] as { payload: { prNumber: number } }).payload.prNumber, 77);
    }),
  );

  it.effect("fails an open PR step when no PR exists on the remote", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-open-none",
        ticketId: "ticket-pr-open-none",
        stepRunId: "step-run-pr-open-none",
        stepKey: "open-pr",
      });

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-open-none",
      );
      assert.deepEqual(calls, [
        {
          stepRunId: "step-run-pr-open-none",
          result: { _tag: "failed", error: "PR open interrupted by restart" },
        },
      ]);
    }),
  );

  it.effect("completes a land PR step when prDetail reports merged", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      gitHubPortScript.prDetailState = "merged";
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-land-merged",
        ticketId: "ticket-pr-land-merged",
        stepRunId: "step-run-pr-land-merged",
        stepKey: "land-pr",
      });
      yield* seedPrStateRow("ticket-pr-land-merged", 55);

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-land-merged",
      );
      assert.deepEqual(calls, [
        { stepRunId: "step-run-pr-land-merged", result: { _tag: "completed" } },
      ]);
    }),
  );

  it.effect("fails a land PR step when prDetail reports not merged", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      gitHubPortScript.prDetailState = "open";
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-land-open",
        ticketId: "ticket-pr-land-open",
        stepRunId: "step-run-pr-land-open",
        stepKey: "land-pr",
      });
      yield* seedPrStateRow("ticket-pr-land-open", 56);

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-land-open",
      );
      assert.deepEqual(calls, [
        {
          stepRunId: "step-run-pr-land-open",
          result: { _tag: "failed", error: "land interrupted by restart" },
        },
      ]);
    }),
  );

  it.effect("fails a land PR step when no PR state is recorded", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const recovery = yield* WorkflowRecovery;

      yield* seedPrStep({
        boardId: "board-pr-land-norow",
        ticketId: "ticket-pr-land-norow",
        stepRunId: "step-run-pr-land-norow",
        stepKey: "land-pr",
      });

      yield* recovery.recover();

      const calls = completedRecoveredSteps.filter(
        (call) => call.stepRunId === "step-run-pr-land-norow",
      );
      assert.deepEqual(calls, [
        {
          stepRunId: "step-run-pr-land-norow",
          result: { _tag: "failed", error: "land interrupted by restart" },
        },
      ]);
    }),
  );

  it.effect("fails a running step whose outbox rows were confirmed before the terminal event", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;

      yield* sql`
        INSERT INTO p_workflow_boards_projection_board (
          board_id,
          project_id,
          name,
          workflow_file_path,
          workflow_version_hash,
          max_concurrent_tickets
        )
        VALUES (
          'board-confirmed-crash',
          'project-confirmed-crash',
          'Confirmed Crash',
          '.t3/boards/confirmed-crash.json',
          'hash-confirmed-crash',
          1
        )
      `;
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
        VALUES (
          'ticket-confirmed-crash',
          'board-confirmed-crash',
          'Confirmed crash',
          'impl',
          'running',
          '2026-06-07T00:00:00.000Z',
          '2026-06-07T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_step_run (
          step_run_id,
          pipeline_run_id,
          ticket_id,
          step_key,
          step_type,
          status,
          started_at
        )
        VALUES (
          'step-confirmed-crash',
          'pipeline-confirmed-crash',
          'ticket-confirmed-crash',
          'implement',
          'agent',
          'running',
          '2026-06-07T00:00:02.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_dispatch_outbox (
          dispatch_id,
          ticket_id,
          step_run_id,
          thread_id,
          provider_instance,
          model,
          instruction,
          worktree_path,
          status,
          created_at,
          confirmed_at
        )
        VALUES (
          'dispatch-confirmed-crash',
          'ticket-confirmed-crash',
          'step-confirmed-crash',
          'thread-confirmed-crash',
          'codex',
          'gpt-5.5',
          'implement',
          '/tmp/wt-confirmed-crash',
          'abandoned',
          '2026-06-07T00:00:03.000Z',
          '2026-06-07T00:30:00.000Z'
        )
      `;

      yield* recovery.recover();

      assert.deepEqual(completedRecoveredSteps, [
        {
          stepRunId: "step-confirmed-crash",
          result: { _tag: "failed", error: "step interrupted by server restart" },
        },
      ]);
    }),
  );

  it.effect("fails running script runs after restart", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;

      yield* sql`
        INSERT INTO p_workflow_boards_projection_step_run (
          step_run_id,
          pipeline_run_id,
          ticket_id,
          step_key,
          step_type,
          status,
          started_at
        )
        VALUES (
          'step-script-restart',
          'pipeline-script-restart',
          'ticket-script-restart',
          'test-script',
          'script',
          'running',
          '2026-07-03T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_script_run (
          script_run_id,
          step_run_id,
          ticket_id,
          script_thread_id,
          terminal_id,
          status,
          started_at
        )
        VALUES (
          'script-restart',
          'step-script-restart',
          'ticket-script-restart',
          'thread-script-restart',
          'terminal-script-restart',
          'running',
          '2026-07-03T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_worktree_lease (
          worktree_ref,
          owner_kind,
          owner_id,
          fence_token,
          acquired_at,
          expires_at
        )
        VALUES (
          'wt-script-restart',
          'step',
          'step-script-restart',
          8,
          '2026-07-03T00:00:01.000Z',
          '2026-07-03T00:30:01.000Z'
        )
      `;

      yield* recovery.recover();

      assert.deepEqual(completedRecoveredSteps, [
        {
          stepRunId: "step-script-restart",
          result: { _tag: "failed", error: "script interrupted by server restart" },
        },
      ]);
    }),
  );

  it.effect("settles interrupted review panels instead of recovering one member", () =>
    Effect.gen(function* () {
      yield* resetRecoveryState();
      const sql = yield* SqlClient.SqlClient;
      const recovery = yield* WorkflowRecovery;
      const registry = yield* BoardRegistry;

      yield* registry.register("board-panel-restart" as never, {
        name: "panel restart",
        lanes: [
          {
            key: "review",
            name: "Review",
            entry: "auto",
            pipeline: [
              {
                key: "panel",
                type: "agent",
                agent: { instance: "codex", model: "gpt-5.5" },
                instruction: "review",
                panel: 2,
                captureOutput: true,
              },
            ],
          },
        ],
      });
      yield* sql`
        INSERT INTO p_workflow_boards_projection_board (
          board_id,
          project_id,
          name,
          workflow_file_path,
          workflow_version_hash,
          max_concurrent_tickets
        )
        VALUES (
          'board-panel-restart',
          'project-panel-restart',
          'Panel Restart',
          '.t3/boards/panel-restart.json',
          'hash-panel-restart',
          1
        )
      `;
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
        VALUES (
          'ticket-panel-restart',
          'board-panel-restart',
          'Panel restart',
          'review',
          'running',
          '2026-07-03T00:00:00.000Z',
          '2026-07-03T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_projection_step_run (
          step_run_id,
          pipeline_run_id,
          ticket_id,
          step_key,
          step_type,
          status,
          started_at
        )
        VALUES (
          'step-panel-restart',
          'pipeline-panel-restart',
          'ticket-panel-restart',
          'panel',
          'agent',
          'running',
          '2026-07-03T00:00:02.000Z'
        )
      `;
      yield* sql`
        INSERT INTO p_workflow_boards_dispatch_outbox (
          dispatch_id,
          ticket_id,
          step_run_id,
          thread_id,
          provider_instance,
          model,
          instruction,
          worktree_path,
          status,
          created_at,
          message_id
        )
        VALUES
          (
            'dispatch-panel-restart-a',
            'ticket-panel-restart',
            'step-panel-restart',
            'thread-panel-restart-a',
            'codex',
            'gpt-5.5',
            'review',
            '/tmp/panel-restart',
            'projected',
            '2026-07-03T00:00:03.000Z',
            'message-panel-restart-a'
          ),
          (
            'dispatch-panel-restart-b',
            'ticket-panel-restart',
            'step-panel-restart',
            'thread-panel-restart-b',
            'codex',
            'gpt-5.5',
            'review',
            '/tmp/panel-restart',
            'start_requested',
            '2026-07-03T00:00:04.000Z',
            'message-panel-restart-b'
          )
      `;

      yield* recovery.recover();

      assert.deepEqual(completedRecoveredSteps[0], {
        stepRunId: "step-panel-restart",
        result: {
          _tag: "failed",
          error: "review panel interrupted by restart",
          retryable: true,
        },
      });
      const rows = yield* sql<{ readonly status: string }>`
        SELECT status
        FROM p_workflow_boards_dispatch_outbox
        WHERE step_run_id = 'step-panel-restart'
        ORDER BY dispatch_id ASC
      `;
      assert.deepEqual(
        rows.map((row) => row.status),
        ["abandoned", "abandoned"],
      );
    }),
  );
});
