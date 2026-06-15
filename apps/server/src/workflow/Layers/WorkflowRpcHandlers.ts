import type {
  BoardListEntry,
  BoardSnapshot,
  BoardTicketView,
  WorkflowIntakeResult,
  EnvironmentAuthorizationError,
  ProjectId,
  StepRunId,
  StepRunStatus,
  TicketAttachment,
  TicketId,
  TicketStatus,
  WorkflowBoardVersionSummary,
  WorkflowCreateBoardInput as WorkflowCreateBoardInputType,
  WorkflowGetBoardDefinitionResult,
  WorkflowGetBoardVersionResult,
  WorkflowImportBoardInput as WorkflowImportBoardInputType,
  WorkflowImportBoardResult,
  WorkflowLintError,
  WorkflowNeedsAttentionTicketView,
  WorkflowRenameBoardInput as WorkflowRenameBoardInputType,
  WorkflowSaveBoardDefinitionInput,
  WorkflowSaveBoardDefinitionResult,
  WorkflowStepRunView,
  WorkflowTicketDetailView,
  WorkflowDefinition as WorkflowDefinitionType,
  WorkflowDefinitionEncoded,
  WorkflowDryRunScenario,
  WorkflowDryRunResult as WorkflowDryRunResultType,
  WorkflowBoardProposalView,
  WorkflowProposeBoardImprovementInput as WorkflowProposeBoardImprovementInputType,
  WorkflowProposeBoardImprovementResult,
  WorkflowListBoardProposalsResult,
  WorkflowGetBoardProposalResult,
  WorkflowListBoardProposalsInput as WorkflowListBoardProposalsInputType,
  WorkflowGetBoardProposalInput as WorkflowGetBoardProposalInputType,
  WorkflowResolveBoardProposalInput as WorkflowResolveBoardProposalInputType,
  WorkflowResolveBoardProposalResult,
  WorkflowRevertBoardProposalInput as WorkflowRevertBoardProposalInputType,
  WorkflowRevertBoardProposalResult,
  WorkflowListBoardTemplatesResult,
  WorkflowCreateWorkflowBoardInput as WorkflowCreateWorkflowBoardInputType,
  WorkflowCreateWorkflowBoardResult,
  WorkflowGenerateWorkflowDraftInput as WorkflowGenerateWorkflowDraftInputType,
  WorkflowGenerateWorkflowDraftResult,
  ModelSelection as ModelSelectionType,
} from "@t3tools/contracts";
import type { WorkSourceConnectionView } from "@t3tools/contracts/workSource";
import type { WorkSourceProviderName } from "@t3tools/contracts/workSource";
import type { CreateOutboundConnectionInput, OutboundConnectionView } from "@t3tools/contracts";
import {
  AgentSelection,
  BoardId,
  LaneKey,
  StepKey,
  WORKFLOW_WS_METHODS,
  WorkflowCreateBoardInput,
  WorkflowDefinition,
  WorkflowProposalValidation,
  WorkflowRenameBoardInput,
  WorkflowRpcError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { WorkspaceFileSystemShape } from "../../workspace/Services/WorkspaceFileSystem.ts";
import { slugifyBoardName, uniqueBoardSlug } from "../boardSlug.ts";
import { BOARD_TEMPLATES, listBoardTemplateSummaries } from "../boardTemplates.ts";
import { defaultBoardDefinition } from "../defaultBoard.ts";
import {
  MAX_IMPORT_DEFINITION_CHARS,
  MAX_IMPORT_LANES,
  MAX_IMPORT_PER_LANE,
} from "../definitionCaps.ts";
import { emptyBoardDefinition } from "../emptyBoard.ts";
import type { BoardDiscoveryShape } from "../Services/BoardDiscovery.ts";
import type { BoardRegistryShape } from "../Services/BoardRegistry.ts";
import type { ProjectScriptTrustShape } from "../Services/ProjectScriptTrust.ts";
import type { ProjectWorkspaceResolverShape } from "../Services/ProjectWorkspaceResolver.ts";
import type { WorkflowBoardEventsShape } from "../Services/WorkflowBoardEvents.ts";
import type { WorkflowBoardSaveLocksShape } from "../Services/WorkflowBoardSaveLocks.ts";
import type {
  WorkflowBoardVersionSource,
  WorkflowBoardVersionSummaryRow,
  WorkflowBoardVersionStoreShape,
} from "../Services/WorkflowBoardVersionStore.ts";
import type { WorkflowEngineShape } from "../Services/WorkflowEngine.ts";
import type { WorkflowEventStoreShape } from "../Services/WorkflowEventStore.ts";
import type { WorkflowFileLoaderShape } from "../Services/WorkflowFileLoader.ts";
import type {
  BoardRow,
  StepRunRow,
  TicketRow,
  WorkflowReadModelShape,
} from "../Services/WorkflowReadModel.ts";
import type { TicketDiffQueryShape } from "../Services/TicketDiffQuery.ts";
import type { WorkflowIntakeShape } from "../Services/WorkflowIntake.ts";
import type { PredicateEvaluatorShape } from "../Services/PredicateEvaluator.ts";
import type { WorkflowWebhookShape } from "../Services/WorkflowWebhook.ts";
import type { WorkflowThreadJanitorShape } from "../Services/WorkflowThreadJanitor.ts";
import type { WorkflowWorktreeJanitorShape } from "../Services/WorkflowWorktreeJanitor.ts";
import type { WorkSourceConnectionStoreShape } from "../Services/WorkSourceConnectionStore.ts";
import type { WorkflowOutboundConnectionStoreShape } from "../Services/WorkflowOutboundConnectionStore.ts";
import { deleteWorkflowBoardOwnedState } from "../boardDeletion.ts";
import { simulateBoardRoute } from "../dryRun.ts";
import { sha256Hex } from "../workflowVersionHash.ts";
import { encodeWorkflowDefinitionJson, type LintError } from "../workflowFile.ts";
import { buildProposalPrompt, parseBoardProposal } from "../selfImprove/boardProposalPrompt.ts";
import {
  buildCreatePrompt,
  containsForbiddenStepType,
  injectAgentIntoSteps,
} from "../createWizard/createWorkflowPrompt.ts";
import { dryRunRegression, preservationGate } from "../selfImprove/boardProposalValidation.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";

export interface TicketWorktreeResolverShape {
  readonly resolveForTicket: (
    ticketId: TicketId,
  ) => Effect.Effect<{ readonly cwd: string; readonly baseRef: string }, WorkflowRpcError>;
}

interface WorkflowCreateTicketInput {
  readonly boardId: BoardId;
  readonly title: string;
  readonly description?: string | undefined;
  readonly initialLane: LaneKey;
  readonly dependsOn?: ReadonlyArray<TicketId> | undefined;
  readonly tokenBudget?: number | undefined;
}

interface WorkflowEditTicketInput {
  readonly ticketId: TicketId;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly dependsOn?: ReadonlyArray<TicketId> | undefined;
  readonly tokenBudget?: number | null | undefined;
}

interface WorkflowAnswerTicketStepInput {
  readonly stepRunId: StepRunId;
  readonly text?: string | undefined;
  readonly attachments?: ReadonlyArray<TicketAttachment> | undefined;
}

interface WorkflowDeleteBoardInput {
  readonly boardId: BoardId;
}

type WorkflowCreateBoardHandlerInput = WorkflowCreateBoardInputType;
type WorkflowRenameBoardHandlerInput = WorkflowRenameBoardInputType;

interface WorkflowGetBoardDefinitionInput {
  readonly boardId: BoardId;
}

interface WorkflowGetBoardVersionInput {
  readonly boardId: BoardId;
  readonly versionId: number;
}

interface WorkflowRpcHandlerDeps {
  readonly engine: WorkflowEngineShape;
  readonly eventStore?: Pick<WorkflowEventStoreShape, "deleteForBoard">;
  readonly readModel: WorkflowReadModelShape;
  readonly boardRegistry: BoardRegistryShape;
  readonly boardDiscovery: BoardDiscoveryShape;
  readonly projectWorkspaceResolver: ProjectWorkspaceResolverShape;
  readonly workspaceFileSystem: WorkspaceFileSystemShape;
  readonly ticketDiff: TicketDiffQueryShape;
  readonly ticketWorktrees: TicketWorktreeResolverShape;
  readonly boardEvents: WorkflowBoardEventsShape;
  readonly saveLocks?: WorkflowBoardSaveLocksShape;
  readonly versionStore: WorkflowBoardVersionStoreShape;
  readonly worktreeJanitor?: Pick<WorkflowWorktreeJanitorShape, "collectBoardPlan" | "run">;
  readonly threadJanitor?: Pick<
    WorkflowThreadJanitorShape,
    "collectBoardThreads" | "deleteThreads"
  >;
  readonly intake?: WorkflowIntakeShape;
  readonly webhook?: Pick<WorkflowWebhookShape, "getConfig" | "deleteForBoard">;
  readonly predicates?: PredicateEvaluatorShape;
  // Self-improve (E4): no-tool board-proposal generation. Optional — a server
  // without a configured generation provider simply has the propose RPC fail
  // with a clear "not available" error.
  readonly textGeneration?: Pick<TextGenerationShape, "generateBoardProposal">;
  readonly fileLoader: WorkflowFileLoaderShape;
  readonly projectScriptTrust: ProjectScriptTrustShape;
  readonly connectionStore: WorkSourceConnectionStoreShape;
  readonly outboundConnectionStore?: WorkflowOutboundConnectionStoreShape;
  readonly observeRpcEffect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly observeRpcStreamEffect: <A, StreamError, StreamContext, EffectError, EffectContext>(
    method: string,
    effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Stream.Stream<
    A,
    StreamError | EffectError | EnvironmentAuthorizationError,
    StreamContext | EffectContext
  >;
}

const MAX_TICKET_ARTIFACTS = 20;
const MAX_TICKET_ARTIFACT_CHARS = 64_000;
const MAX_DRY_RUN_DEFINITION_CHARS = 256_000;
const MAX_DRY_RUN_LANES = 200;
const MAX_DRY_RUN_PER_LANE = 100;

// Size caps shared by the import/save paths AND the disk load path
// (WorkflowFileLoader.loadAndRegister) — imported from a single module so the
// two never diverge. Generous enough that any realistically-authored board
// round-trips (export → re-import, edit → save), but bounding memory/CPU so no
// path can persist/register an arbitrarily large definition. A pure DoS
// backstop, deliberately decoupled from dryRunBoard's tighter MAX_DRY_RUN_*.
// (See ../definitionCaps.ts; re-aliased here so the existing references below
// keep their names.)

// Lint codes that depend on the target environment (which provider instances
// are configured / which instruction files are checked in) rather than on the
// structural correctness of the definition itself. On import these are surfaced
// as warnings — the board is still created — because the importing environment
// may legitimately differ from the source environment. Every other lint code is
// a blocking authoring error. The literals MUST match LintCode in workflowFile.ts.
const ENV_BOUND_LINT_CODES: ReadonlySet<LintError["code"]> = new Set([
  "unknown_provider_instance",
  "missing_instruction_file",
]);

const toBoardTicketView = (ticket: TicketRow): BoardTicketView => ({
  ticketId: ticket.ticketId as TicketId,
  boardId: ticket.boardId as BoardId,
  title: ticket.title,
  ...(ticket.description === null ? {} : { description: ticket.description }),
  currentLaneKey: ticket.currentLaneKey as LaneKey,
  status: ticket.status as TicketStatus,
  ...(ticket.queuedAt === null ? {} : { queuedAt: ticket.queuedAt }),
  ...(ticket.dependsOn === undefined || ticket.dependsOn.length === 0
    ? {}
    : { dependsOn: ticket.dependsOn as ReadonlyArray<TicketId> }),
  ...(ticket.unresolvedDependencyCount === undefined || ticket.unresolvedDependencyCount === 0
    ? {}
    : { unresolvedDependencyCount: ticket.unresolvedDependencyCount }),
  ...(typeof ticket.tokenBudget === "number" ? { tokenBudget: ticket.tokenBudget } : {}),
  ...(ticket.updatedAt === undefined ? {} : { updatedAt: ticket.updatedAt }),
  ...(typeof ticket.totalTokens === "number" && ticket.totalTokens > 0
    ? { totalTokens: ticket.totalTokens }
    : {}),
  ...(typeof ticket.totalDurationMs === "number" && ticket.totalDurationMs > 0
    ? { totalDurationMs: ticket.totalDurationMs }
    : {}),
  ...(ticket.pr === undefined ? {} : { pr: ticket.pr }),
  // Attention fields — present when the ticket is in a needs-attention state.
  ...(ticket.attentionKind == null ? {} : { attentionKind: ticket.attentionKind as never }),
  ...(ticket.attentionReason == null ? {} : { attentionReason: ticket.attentionReason }),
  // Current lane detail — present on detail reads (resolved from board definition).
  ...(ticket.currentLane === undefined
    ? {}
    : {
        currentLane: {
          key: ticket.currentLane.key as LaneKey,
          name: ticket.currentLane.name,
          actions: ticket.currentLane.actions.map((a) => ({
            label: a.label,
            to: a.to as LaneKey,
            ...(a.hint === undefined ? {} : { hint: a.hint }),
          })),
        },
      }),
});

const toStepUsageView = (step: StepRunRow) => {
  if (
    step.inputTokens === null &&
    step.cachedInputTokens === null &&
    step.outputTokens === null &&
    step.totalTokens === null
  ) {
    return undefined;
  }
  return {
    ...(step.inputTokens === null ? {} : { inputTokens: step.inputTokens }),
    ...(step.cachedInputTokens === null ? {} : { cachedInputTokens: step.cachedInputTokens }),
    ...(step.outputTokens === null ? {} : { outputTokens: step.outputTokens }),
    ...(step.totalTokens === null ? {} : { totalTokens: step.totalTokens }),
  };
};

const toStepRunView = (step: StepRunRow): WorkflowStepRunView => ({
  stepRunId: step.stepRunId as never,
  stepKey: step.stepKey as never,
  stepType: step.stepType as "agent" | "approval",
  ...(step.attempt === null || step.attempt === 1 ? {} : { attempt: step.attempt }),
  status: step.status as StepRunStatus,
  waitingReason: step.waitingReason,
  blockedReason: step.blockedReason,
  providerResponseKind: step.providerResponseKind,
  scriptThreadId: step.scriptThreadId as never,
  terminalId: step.terminalId,
  scriptStatus: step.scriptStatus as never,
  exitCode: step.exitCode,
  signal: step.signal,
  ...(step.output === null ? {} : { output: step.output }),
  ...(step.startedAt === null ? {} : { startedAt: step.startedAt as never }),
  ...(step.finishedAt === null ? {} : { finishedAt: step.finishedAt as never }),
  ...(toStepUsageView(step) === undefined ? {} : { usage: toStepUsageView(step) }),
  ...(step.providerThreadId === null ? {} : { providerThreadId: step.providerThreadId as never }),
});

const workflowRpcError = (message: string, cause?: unknown) =>
  new WorkflowRpcError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const decodeWorkflowDefinition = Schema.decodeUnknownEffect(WorkflowDefinition);
const decodeWorkflowCreateBoardInput = Schema.decodeUnknownEffect(WorkflowCreateBoardInput);
const decodeWorkflowRenameBoardInput = Schema.decodeUnknownEffect(WorkflowRenameBoardInput);
const decodeWorkflowDefinitionJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WorkflowDefinition),
);
const encodeWorkflowDefinition = Schema.encodeSync(WorkflowDefinition);
const encodeAgentSelectionJson = Schema.encodeSync(Schema.fromJsonString(AgentSelection));
const encodeWorkflowProposalValidationJson = Schema.encodeSync(
  Schema.fromJsonString(WorkflowProposalValidation),
);
const WORKFLOW_BOARD_FILE_PATH_PATTERN = /^\.t3\/boards\/[A-Za-z0-9_-]+\.json$/;

const toWorkflowRpcError = (message: string) => (cause: unknown) =>
  workflowRpcError(message, cause);

const toContractLintError = (error: LintError): WorkflowLintError => ({
  code: error.code,
  message: error.message,
  ...(error.laneKey === undefined ? {} : { laneKey: LaneKey.make(error.laneKey) }),
  ...(error.stepKey === undefined ? {} : { stepKey: StepKey.make(error.stepKey) }),
  ...(error.transitionIndex === undefined ? {} : { transitionIndex: error.transitionIndex }),
});

const workflowDefinitionContentJson = (definition: WorkflowDefinitionType): string =>
  `${encodeWorkflowDefinitionJson(definition)}\n`;

const workflowDefinitionVersionHash = (definition: WorkflowDefinitionType): string =>
  sha256Hex(workflowDefinitionContentJson(definition));

const recordBoardVersionBestEffort = (
  deps: Pick<WorkflowRpcHandlerDeps, "versionStore">,
  input: {
    readonly boardId: BoardId;
    readonly versionHash: string;
    readonly contentJson: string;
    readonly source: WorkflowBoardVersionSource;
  },
): Effect.Effect<void> =>
  deps.versionStore.record(input).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to record workflow board version", {
        boardId: input.boardId,
        source: input.source,
        cause: Cause.pretty(cause),
      }),
    ),
  );

const recordBoardVersionRequired = (
  deps: Pick<WorkflowRpcHandlerDeps, "versionStore">,
  input: {
    readonly boardId: BoardId;
    readonly versionHash: string;
    readonly contentJson: string;
    readonly source: WorkflowBoardVersionSource;
  },
): Effect.Effect<void, WorkflowRpcError> =>
  deps.versionStore
    .record(input)
    .pipe(Effect.mapError(toWorkflowRpcError("Failed to record workflow board version")));

const boardSnapshot = (
  deps: Pick<WorkflowRpcHandlerDeps, "boardRegistry" | "readModel">,
  boardId: BoardId,
): Effect.Effect<BoardSnapshot, WorkflowRpcError> =>
  Effect.gen(function* () {
    const board = yield* deps.readModel
      .getBoard(boardId)
      .pipe(Effect.mapError((cause) => workflowRpcError("Failed to load workflow board", cause)));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${boardId} was not found`);
    }

    const definition = yield* deps.boardRegistry.getDefinition(boardId);
    if (!definition) {
      return yield* workflowRpcError(`Workflow board definition ${boardId} was not found`);
    }

    const tickets = yield* deps.readModel
      .listTickets(boardId)
      .pipe(Effect.mapError((cause) => workflowRpcError("Failed to load workflow tickets", cause)));

    return {
      projectId: board.projectId as ProjectId,
      board: {
        boardId,
        name: board.name,
        lanes: definition.lanes.map((lane) => ({
          key: lane.key,
          name: lane.name,
          entry: lane.entry,
          pipelineStepCount: lane.pipeline?.length ?? 0,
          ...(lane.wipLimit === undefined ? {} : { wipLimit: lane.wipLimit }),
          ...(lane.terminal === undefined ? {} : { terminal: lane.terminal }),
          ...(lane.actions === undefined || lane.actions.length === 0
            ? {}
            : { actions: lane.actions }),
        })),
      },
      tickets: tickets.map(toBoardTicketView),
    } satisfies BoardSnapshot;
  });

const ticketDetail = (
  deps: Pick<WorkflowRpcHandlerDeps, "readModel">,
  ticketId: TicketId,
): Effect.Effect<WorkflowTicketDetailView, WorkflowRpcError> =>
  Effect.gen(function* () {
    const detail = yield* deps.readModel
      .getTicketDetail(ticketId)
      .pipe(
        Effect.mapError((cause) =>
          workflowRpcError("Failed to load workflow ticket detail", cause),
        ),
      );
    if (!detail) {
      return yield* workflowRpcError(`Workflow ticket ${ticketId} was not found`);
    }
    const routeDecisions = yield* deps.readModel
      .listTicketRouteDecisions(ticketId)
      .pipe(
        Effect.mapError((cause) =>
          workflowRpcError("Failed to load workflow ticket route history", cause),
        ),
      );

    return {
      routeHistory: routeDecisions.map((decision) => ({
        occurredAt: decision.occurredAt as never,
        ...(decision.fromLane === null ? {} : { fromLane: decision.fromLane as never }),
        toLane: decision.toLane as never,
        source: decision.source,
        ...(decision.matchedTransitionIndex === null
          ? {}
          : { matchedTransitionIndex: decision.matchedTransitionIndex }),
        ...(decision.eventName === null ? {} : { eventName: decision.eventName }),
        ...(decision.pipelineResult === null ? {} : { pipelineResult: decision.pipelineResult }),
        ...(decision.laneRunCount === null ? {} : { laneRunCount: decision.laneRunCount }),
        ...(decision.steps === null
          ? {}
          : {
              steps: Object.fromEntries(
                Object.entries(decision.steps).map(([stepKey, step]) => [
                  stepKey,
                  {
                    status: step.status,
                    ...(step.exitCode === null ? {} : { exitCode: step.exitCode }),
                    ...(step.verdict === null ? {} : { verdict: step.verdict }),
                  },
                ]),
              ),
            }),
      })),
      ticket: toBoardTicketView(detail.ticket),
      steps: detail.steps.map(toStepRunView),
      messages: detail.messages.map((message) => ({
        messageId: message.messageId,
        ticketId: message.ticketId,
        ...(message.stepRunId === null ? {} : { stepRunId: message.stepRunId }),
        author: message.author,
        body: message.body,
        attachments: [...message.attachments],
        createdAt: message.createdAt,
      })),
      ...(detail.syncedSource !== undefined ? { syncedSource: detail.syncedSource } : {}),
    } satisfies WorkflowTicketDetailView;
  });

const slugFromBoardEntry = (entry: BoardListEntry): string | null => {
  const fileName = entry.filePath.split("/").at(-1);
  return fileName?.endsWith(".json") ? fileName.slice(0, -".json".length) : null;
};

const createBoardFromDefinition = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "boardDiscovery"
    | "projectWorkspaceResolver"
    | "workspaceFileSystem"
    | "fileLoader"
    | "boardRegistry"
    | "readModel"
    | "saveLocks"
    | "versionStore"
  >,
  args: {
    readonly projectId: ProjectId;
    readonly definition: WorkflowDefinitionType;
    readonly versionSource: WorkflowBoardVersionSource;
    // "strict" (default) runs the file loader's full lint on register and fails
    // on any error. "skip" is used by import, which has already linted and
    // decided env-bound findings are warnings rather than blockers.
    readonly lintMode?: "strict" | "skip";
  },
): Effect.Effect<
  { readonly boardId: BoardId; readonly snapshot: BoardSnapshot },
  WorkflowRpcError
> =>
  Effect.gen(function* () {
    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(args.projectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));
    const existingEntries = yield* deps.boardDiscovery.discover(args.projectId);
    const existingSlugs = new Set(
      existingEntries.flatMap((entry) => {
        const slug = slugFromBoardEntry(entry);
        return slug === null ? [] : [slug];
      }),
    );
    const slug = uniqueBoardSlug(slugifyBoardName(args.definition.name), existingSlugs);
    const boardId = BoardId.make(`${args.projectId}__${slug}`);
    const relativePath = `.t3/boards/${slug}.json`;
    const contentJson = workflowDefinitionContentJson(args.definition);

    return yield* (deps.saveLocks?.withSaveLock ?? ((_boardId, effect) => effect))(
      boardId,
      Effect.gen(function* () {
        yield* deps.workspaceFileSystem
          .createFileExclusive({
            projectRoot: workspaceRoot,
            relativePath,
            contents: contentJson,
          })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to create workflow board file")));
        yield* deps.fileLoader
          .loadAndRegister({
            boardId,
            projectId: args.projectId,
            workspaceRoot,
            relativePath,
            ...(args.lintMode === undefined ? {} : { lintMode: args.lintMode }),
          })
          .pipe(
            Effect.mapError(toWorkflowRpcError("Failed to register created workflow board")),
            // The file was created above; if register fails we would otherwise
            // leave an orphan board file. Best-effort delete before re-failing.
            Effect.tapError(() =>
              deps.workspaceFileSystem
                .deleteFile({ cwd: workspaceRoot, relativePath })
                .pipe(Effect.ignore),
            ),
          );

        const createdBoard = yield* deps.readModel
          .getBoard(boardId)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to load created workflow board")));
        if (!createdBoard) {
          return yield* workflowRpcError(`Workflow board ${boardId} was not found after create`);
        }
        yield* recordBoardVersionBestEffort(deps, {
          boardId,
          versionHash: createdBoard.workflowVersionHash,
          contentJson,
          source: args.versionSource,
        });

        const snapshot = yield* boardSnapshot(deps, boardId);
        return { boardId, snapshot };
      }),
    );
  });

const createBoard = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "boardDiscovery"
    | "projectWorkspaceResolver"
    | "workspaceFileSystem"
    | "fileLoader"
    | "boardRegistry"
    | "readModel"
    | "saveLocks"
    | "versionStore"
  >,
  input: WorkflowCreateBoardHandlerInput,
): Effect.Effect<
  { readonly boardId: BoardId; readonly snapshot: BoardSnapshot },
  WorkflowRpcError
> =>
  decodeWorkflowCreateBoardInput(input).pipe(
    Effect.mapError(toWorkflowRpcError("workflow board create input decode failed")),
    Effect.flatMap((decoded) =>
      createBoardFromDefinition(deps, {
        projectId: decoded.projectId,
        definition: defaultBoardDefinition({ name: decoded.name, agent: decoded.agent }),
        versionSource: "create",
      }),
    ),
  );

// Shared deps Pick for the validate-and-create pipeline. Identical to the set
// createBoardFromDefinition needs — validateAndCreateBoard only adds the lint
// step, which uses fileLoader/projectWorkspaceResolver already in the set.
type ValidateAndCreateDeps = Pick<
  WorkflowRpcHandlerDeps,
  | "boardDiscovery"
  | "projectWorkspaceResolver"
  | "workspaceFileSystem"
  | "fileLoader"
  | "boardRegistry"
  | "readModel"
  | "saveLocks"
  | "versionStore"
>;

/**
 * Shared defense + create pipeline for untrusted client-supplied board
 * definitions. Used by importBoard (mode:"import") and createWorkflowBoard
 * (mode:"create"). Both modes run the IDENTICAL size/lane/decode/lint gates;
 * they differ ONLY in how lint findings are partitioned:
 *
 *   - mode:"import"  → env-bound codes (unknown provider instance / missing
 *                      instruction file) are downgraded to non-blocking
 *                      warnings, because the importing environment may
 *                      legitimately differ from the source environment. Every
 *                      other code blocks.
 *   - mode:"create"  → ALL lint errors block; there are never warnings. A board
 *                      being authored locally must reference things that exist
 *                      in THIS environment.
 *
 * Returns the same discriminated shape importBoard returns today
 * ({ok:true, boardId, warnings} | {ok:false, lintErrors}). In create-mode
 * `warnings` is always [].
 */
export const validateAndCreateBoard = (
  deps: ValidateAndCreateDeps,
  args: {
    readonly projectId: ProjectId;
    // The RAW, untrusted, still-encoded client payload (NOT yet decoded).
    readonly encodedDefinition: WorkflowImportBoardInputType["definition"];
    readonly mode: "import" | "create";
    // OPTIONAL post-lint hook. Invoked on the DECODED definition AFTER the
    // strict lint gate passes and BEFORE the board is persisted. Lets a caller
    // run an additional, ALREADY-bounded check (e.g. createWorkflowBoard's
    // dead-end dry-run) at the correct point in the pipeline — after the cheap
    // size/lane/lint caps have validated and bounded the def — without
    // duplicating those caps. Returning {ok:false, message} rejects the def as a
    // renderable "invalid_step" lintError and persists nothing. When undefined
    // (import-mode + empty/template create) behavior is UNCHANGED.
    readonly afterLint?: (
      decoded: WorkflowDefinitionType,
    ) => Effect.Effect<
      { readonly ok: true } | { readonly ok: false; readonly message: string },
      WorkflowRpcError
    >;
  },
): Effect.Effect<WorkflowImportBoardResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    // Helper: every USER-INPUT validation failure (too large, bad shape, too many
    // lanes) must return a renderable {ok:false, lintErrors} — NOT a transport
    // WorkflowRpcError — so the calling dialog can show it inline as an actionable
    // lint error. "invalid_step" is the most fitting existing WorkflowLintCode for
    // a malformed/oversized definition. WorkflowRpcError stays reserved for genuine
    // server-side failures (workspace resolve, file write, etc.).
    const importLintFailure = (message: string): WorkflowImportBoardResult => ({
      ok: false,
      lintErrors: [{ code: "invalid_step", message }],
    });

    // 1. Guarded byte-size probe on the RAW payload — the ONLY thing that touches
    //    untyped input before decode. JSON.stringify is wrapped in try/catch
    //    because a pathologically deep/circular object can throw a RangeError
    //    before the length comparison; treat that as "too large" and return a
    //    clean {ok:false} result rather than letting a defect escape.
    let definitionJsonLength: number;
    // @effect-diagnostics-next-line tryCatchInEffectGen:off — synchronous size probe; not an Effect failure
    try {
      // @effect-diagnostics-next-line preferSchemaOverJson:off — pure size probe, not parsing
      definitionJsonLength = JSON.stringify(args.encodedDefinition).length;
    } catch {
      return importLintFailure(
        `Board definition is too large to import (exceeds ${MAX_IMPORT_DEFINITION_CHARS} characters)`,
      );
    }
    if (definitionJsonLength > MAX_IMPORT_DEFINITION_CHARS) {
      return importLintFailure(
        `Board definition is too large to import (exceeds ${MAX_IMPORT_DEFINITION_CHARS} characters)`,
      );
    }

    // 2. Decode BEFORE reading any typed fields. A structural decode failure maps
    //    to a single blocking lintError so the calling dialog can render it like
    //    any other rejection.
    const decodeExit = Schema.decodeUnknownExit(WorkflowDefinition)(args.encodedDefinition);
    if (Exit.isFailure(decodeExit)) {
      return importLintFailure(
        "Workflow definition is structurally invalid and could not be decoded",
      );
    }
    const decoded = decodeExit.value;

    // 3. Lane / per-lane caps on the DECODED definition (never on raw input).
    //    Generous DoS-only ceilings, decoupled from dryRunBoard's tighter limits,
    //    so a large-but-valid saved board round-trips through export → import.
    if (decoded.lanes.length > MAX_IMPORT_LANES) {
      return importLintFailure(
        `Board definition is too large to import (exceeds ${MAX_IMPORT_LANES} lanes)`,
      );
    }
    if (
      decoded.lanes.some(
        (lane) =>
          (lane.pipeline?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.transitions?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.onEvent?.length ?? 0) > MAX_IMPORT_PER_LANE,
      )
    ) {
      return importLintFailure(
        `Board definition is too large to import (a lane exceeds ${MAX_IMPORT_PER_LANE} pipeline steps, transitions, or event handlers)`,
      );
    }

    // 4. Lint — run the SAME strict lint persist uses (identical in both modes).
    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(args.projectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));
    const lintErrors = yield* deps.fileLoader
      .lintDefinition({
        definition: decoded,
        projectId: args.projectId,
        workspaceRoot,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("workflow lint failed")));

    // 5. Partition. import-mode downgrades env-bound codes to warnings;
    //    create-mode blocks on EVERY lint error (no warnings).
    const blocking =
      args.mode === "import"
        ? lintErrors.filter((error) => !ENV_BOUND_LINT_CODES.has(error.code))
        : lintErrors;
    const warnings =
      args.mode === "import"
        ? lintErrors
            .filter((error) => ENV_BOUND_LINT_CODES.has(error.code))
            .map((error) => error.message)
        : [];

    // Any blocking error → no file written, no board created.
    if (blocking.length > 0) {
      return { ok: false, lintErrors: blocking.map(toContractLintError) };
    }

    // 5b. Optional post-lint hook (e.g. the dead-end dry-run gate). Runs only
    //     AFTER caps + decode + lint have bounded/validated the def, so an
    //     untrusted oversized def is rejected by the cheap caps above BEFORE any
    //     expensive per-lane simulation. A {ok:false} surfaces as a renderable
    //     "invalid_step" lintError (the only failure shape this helper returns)
    //     and persists nothing.
    if (args.afterLint !== undefined) {
      const hook = yield* args.afterLint(decoded);
      if (!hook.ok) {
        return importLintFailure(hook.message);
      }
    }

    // 6. Create the board WITHOUT re-running the strict lint (already linted above).
    //    lintMode:"skip" in BOTH modes — re-linting in createBoardFromDefinition
    //    would be redundant and, in import-mode, would re-reject the env-bound
    //    codes we intentionally downgraded to warnings.
    const created = yield* createBoardFromDefinition(deps, {
      projectId: args.projectId,
      definition: decoded,
      versionSource: args.mode === "import" ? "import" : "create",
      lintMode: "skip",
    });
    return { ok: true, boardId: created.boardId, warnings };
  });

const importBoard = (
  deps: ValidateAndCreateDeps,
  input: WorkflowImportBoardInputType,
): Effect.Effect<WorkflowImportBoardResult, WorkflowRpcError> =>
  validateAndCreateBoard(deps, {
    projectId: input.projectId,
    encodedDefinition: input.definition,
    mode: "import",
  });

/**
 * `createWorkflowBoard` — the Create Workflow Wizard's board-create handler. It
 * resolves the wizard's {@link WorkflowCreateChoice} into a raw/encoded
 * {@link WorkflowDefinitionEncoded} and routes it through the SAME create-mode
 * {@link validateAndCreateBoard} pipeline import uses (size caps → decode → lane
 * caps → strict lint → create-from-def). In create-mode EVERY lint error blocks
 * and there are never warnings.
 *
 * Two early returns happen BEFORE any definition is built or written:
 *   - an unknown templateId, and
 *   - a `requiresAgent` template invoked without an agent.
 * Both surface as {ok:false, lintErrors:[], message} so the wizard can show the
 * reason inline without inventing a fake lint error.
 *
 * The helper's success shape ({ok:true, boardId, warnings}) is narrowed to the
 * wizard contract result ({ok:true, boardId}) — the `warnings` field is dropped
 * (create-mode warnings are always []). Exported for direct testing and for
 * Task 7 to register against the WS RPC group once it declares the method.
 */
export const createWorkflowBoard = (
  deps: ValidateAndCreateDeps & Pick<WorkflowRpcHandlerDeps, "predicates">,
  input: WorkflowCreateWorkflowBoardInputType,
): Effect.Effect<WorkflowCreateWorkflowBoardResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const { choice } = input;
    let encodedDefinition: WorkflowDefinitionEncoded;
    switch (choice.kind) {
      case "empty":
        encodedDefinition = encodeWorkflowDefinition(emptyBoardDefinition({ name: input.name }));
        break;
      case "template": {
        const tpl = BOARD_TEMPLATES.find((t) => t.id === choice.templateId);
        if (!tpl) {
          return {
            ok: false,
            lintErrors: [],
            message: `Unknown template "${choice.templateId}"`,
          } satisfies WorkflowCreateWorkflowBoardResult;
        }
        const agent = choice.agent;
        if (tpl.requiresAgent && agent === undefined) {
          return {
            ok: false,
            lintErrors: [],
            message: "This template requires an agent.",
          } satisfies WorkflowCreateWorkflowBoardResult;
        }
        // Every current template `requiresAgent`, so the guard above guarantees an
        // agent here. The non-null assertion documents that invariant for the
        // build signature (which takes a required AgentSelection); a future
        // agent-free template would build without one.
        encodedDefinition = encodeWorkflowDefinition(
          tpl.build({ name: input.name, agent: agent! }),
        );
        break;
      }
      case "definition": {
        // Already a raw/encoded WorkflowDefinitionEncoded (untrusted) — the helper
        // re-validates (size caps + decode + lint) it.
        encodedDefinition = choice.definition;
        break;
      }
    }

    // Dead-end dry-run gate — ONLY on the untrusted "definition" choice (the
    // empty/template choices are server-built and dry-run-clean). lint does not
    // check terminal reachability, so a definition can pass the helper's gates
    // yet strand tickets. Run it as validateAndCreateBoard's afterLint hook so it
    // fires only AFTER the cheap caps + decode + lint have bounded/validated the
    // def — never before, so an oversized untrusted def cannot trigger thousands
    // of route simulations before the caps reject it. The dry-run is itself
    // bounded by MAX_DRY_RUN_LANES (mirroring proposeBoardImprovement): a def
    // larger than that already cleared lint + the MAX_IMPORT_LANES cap, so we
    // treat it as not-stranded rather than running an unbounded simulation.
    const afterLint =
      input.choice.kind === "definition" && deps.predicates !== undefined
        ? (decoded: WorkflowDefinitionType) =>
            Effect.gen(function* () {
              if (decoded.lanes.length > MAX_DRY_RUN_LANES) {
                return { ok: true } as const;
              }
              const deadEndLanes = yield* dryRunDeadEndLanes(decoded, deps.predicates!);
              return deadEndLanes.length > 0
                ? ({ ok: false, message: strandingMessage(deadEndLanes) } as const)
                : ({ ok: true } as const);
            })
        : undefined;

    const result = yield* validateAndCreateBoard(deps, {
      projectId: input.projectId,
      encodedDefinition,
      mode: "create",
      ...(afterLint === undefined ? {} : { afterLint }),
    });
    // Narrow the helper result to the wizard contract: drop `warnings` on success
    // (create-mode warnings are always []); pass lintErrors through on failure.
    return result.ok
      ? ({ ok: true, boardId: result.boardId } satisfies WorkflowCreateWorkflowBoardResult)
      : ({ ok: false, lintErrors: result.lintErrors } satisfies WorkflowCreateWorkflowBoardResult);
  });

const deleteBoard = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "readModel"
    | "engine"
    | "eventStore"
    | "boardRegistry"
    | "versionStore"
    | "saveLocks"
    | "projectWorkspaceResolver"
    | "workspaceFileSystem"
    | "worktreeJanitor"
    | "threadJanitor"
    | "webhook"
  >,
  input: WorkflowDeleteBoardInput,
): Effect.Effect<void, WorkflowRpcError> =>
  (deps.saveLocks?.withSaveLock ?? ((_boardId, effect) => effect))(
    input.boardId,
    Effect.gen(function* () {
      const board = yield* deps.readModel
        .getBoard(input.boardId)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));

      if (board) {
        if (!WORKFLOW_BOARD_FILE_PATH_PATTERN.test(board.workflowFilePath)) {
          return yield* workflowRpcError(
            `Workflow board ${input.boardId} is not a deletable workflow board file`,
          );
        }

        const workspaceRoot = yield* deps.projectWorkspaceResolver
          .resolve(board.projectId as ProjectId)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));

        yield* deps.workspaceFileSystem
          .deleteFile({
            cwd: workspaceRoot,
            relativePath: board.workflowFilePath,
          })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to delete workflow board file")));
      }

      yield* deleteWorkflowBoardOwnedState(
        {
          boardRegistry: deps.boardRegistry,
          engine: deps.engine,
          eventStore: deps.eventStore ?? { deleteForBoard: () => Effect.void },
          readModel: deps.readModel,
          versionStore: deps.versionStore,
          ...(deps.worktreeJanitor === undefined ? {} : { worktreeJanitor: deps.worktreeJanitor }),
          ...(deps.threadJanitor === undefined ? {} : { threadJanitor: deps.threadJanitor }),
          ...(deps.webhook === undefined ? {} : { webhook: deps.webhook }),
        },
        input.boardId,
      ).pipe(Effect.mapError(toWorkflowRpcError("Failed to delete workflow board state")));
    }),
  );

const getBoardDefinition = (
  deps: Pick<WorkflowRpcHandlerDeps, "boardRegistry" | "readModel">,
  input: WorkflowGetBoardDefinitionInput,
): Effect.Effect<WorkflowGetBoardDefinitionResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const definition = yield* deps.boardRegistry.getDefinition(input.boardId);
    if (!definition) {
      return yield* workflowRpcError(`Workflow board definition ${input.boardId} was not found`);
    }

    const board = yield* deps.readModel
      .getBoard(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${input.boardId} was not found`);
    }

    return {
      definition: encodeWorkflowDefinition(definition),
      versionHash: board.workflowVersionHash,
    };
  });

// Default metrics window for a proposal — wide enough to surface dead routes
// and chronic step failures.
const PROPOSAL_METRICS_WINDOW_DAYS = 30;

// All three terminal scenarios a dry run can take in each lane.
const DRY_RUN_SCENARIOS: ReadonlyArray<WorkflowDryRunScenario> = ["success", "failure", "blocked"];

// Run every {startLane, scenario} combo for a definition. Bounded: lanes × 3.
const dryRunAllCombos = (definition: WorkflowDefinitionType, evaluator: PredicateEvaluatorShape) =>
  Effect.gen(function* () {
    const results = [];
    for (const lane of definition.lanes) {
      for (const scenario of DRY_RUN_SCENARIOS) {
        results.push(
          yield* simulateBoardRoute({
            definition,
            startLane: lane.key,
            scenario,
            evaluator,
          }),
        );
      }
    }
    return results;
  });

// A dry-run result "strands" a ticket when its route ends with no way out:
// `no_route` (dead-end lane) or `cycle_cap` (looped without reaching terminal).
const STRANDING_DRY_RUN_ENDS: ReadonlySet<WorkflowDryRunResultType["end"]> = new Set([
  "no_route",
  "cycle_cap",
]);

// Cap how many offending lane keys are echoed back in a stranding message so a
// pathological def can't produce an unbounded error string.
const MAX_STRANDING_LANES_IN_MESSAGE = 5;

/**
 * Dry-run dead-end gate for a NEW board (no base to diff against — unlike
 * proposeBoardImprovement, which compares base vs proposed). Runs every
 * lane × scenario combo and returns the DISTINCT start-lane keys whose route
 * strands a ticket (`no_route` / `cycle_cap`). An empty array means every lane
 * has a route out. Bounded: lanes × 3.
 */
const dryRunDeadEndLanes = (
  definition: WorkflowDefinitionType,
  evaluator: PredicateEvaluatorShape,
): Effect.Effect<ReadonlyArray<string>, never> =>
  Effect.gen(function* () {
    const results = yield* dryRunAllCombos(definition, evaluator);
    const deadEndLanes = new Set<string>();
    for (const result of results) {
      if (STRANDING_DRY_RUN_ENDS.has(result.end)) {
        deadEndLanes.add(result.startLane as string);
      }
    }
    return [...deadEndLanes];
  });

// Build the user-facing stranding message for a set of dead-end lane keys
// (capped). Shared by both wizard entry points so the copy stays identical.
const strandingMessage = (laneKeys: ReadonlyArray<string>): string => {
  const shown = laneKeys.slice(0, MAX_STRANDING_LANES_IN_MESSAGE);
  const suffix = laneKeys.length > shown.length ? ", …" : "";
  const lanes = shown.map((key) => `"${key}"`).join(", ");
  return `Generated board strands tickets: ${lanes}${suffix} has no route out.`;
};

/**
 * Generate + validate + store a board-improvement proposal. NEVER calls
 * `saveBoardDefinition` — this path only produces a `workflow_board_proposal`
 * row (pending when all gates pass, invalid otherwise). Applying a proposal is
 * a separate, human-gated path (E5+). Exported for direct testing and for E6 to
 * register against the WS RPC group once it declares the method.
 */
export const proposeBoardImprovement = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "boardRegistry"
    | "readModel"
    | "projectWorkspaceResolver"
    | "fileLoader"
    | "predicates"
    | "textGeneration"
  >,
  input: WorkflowProposeBoardImprovementInputType,
): Effect.Effect<WorkflowProposeBoardImprovementResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const textGeneration = deps.textGeneration;
    if (textGeneration === undefined) {
      return yield* workflowRpcError("Board proposals are not available on this server");
    }
    const predicates = deps.predicates;
    if (predicates === undefined) {
      return yield* workflowRpcError("Board proposals are not available on this server");
    }

    // 1. Load the current definition + version hash + project root + metrics.
    const baseDef = yield* deps.boardRegistry.getDefinition(input.boardId);
    if (!baseDef) {
      return yield* workflowRpcError(`Workflow board definition ${input.boardId} was not found`);
    }
    const board = yield* deps.readModel
      .getBoard(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${input.boardId} was not found`);
    }
    const baseVersionHash = board.workflowVersionHash;
    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(board.projectId as ProjectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));
    const metrics = yield* deps.readModel
      .getBoardMetrics(input.boardId, PROPOSAL_METRICS_WINDOW_DAYS)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to compute board metrics")));

    // Shared bits for whichever proposal row we end up writing.
    const proposalId = yield* Effect.sync(
      // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off
      () => globalThis.crypto.randomUUID() as string,
    );
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const baseDefJson = encodeWorkflowDefinitionJson(baseDef);
    const agentJson = encodeAgentSelectionJson(input.agent);

    // Build a proposal view + persist it. `proposedDefJson` defaults to the base
    // def for early failures (gen / decode) where there is no valid proposed def.
    const finalize = (args: {
      readonly status: WorkflowBoardProposalView["status"];
      readonly rationale: string;
      readonly validation: WorkflowProposalValidation;
      readonly proposedDefJson: string;
    }) =>
      Effect.gen(function* () {
        yield* deps.readModel
          .recordBoardProposal({
            proposalId,
            boardId: input.boardId,
            baseVersionHash,
            baseDefJson,
            agentJson,
            proposedDefJson: args.proposedDefJson,
            rationale: args.rationale,
            validationJson: encodeWorkflowProposalValidationJson(args.validation),
            status: args.status,
            createdAt,
          })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to record board proposal")));
        const proposal: WorkflowBoardProposalView = {
          proposalId,
          boardId: input.boardId,
          status: args.status,
          rationale: args.rationale,
          validation: args.validation,
          baseVersionHash,
          appliedVersionHash: null,
          outdated: false,
          agent: input.agent,
          createdAt,
          resolvedAt: null,
        };
        return { proposal } satisfies WorkflowProposeBoardImprovementResult;
      });

    const invalid = (rationale: string, validation: WorkflowProposalValidation) =>
      finalize({ status: "invalid", rationale, validation, proposedDefJson: baseDefJson });

    const failValidation = (
      overrides: Partial<WorkflowProposalValidation> & { readonly messages: ReadonlyArray<string> },
    ): WorkflowProposalValidation => ({
      preservationOk: false,
      lintOk: false,
      dryRunOk: false,
      laneDiffCount: 0,
      lintErrors: [],
      dryRunRegressions: [],
      ...overrides,
    });

    // 2. Build the prompt (titles stripped + redacted) and generate. The
    //    agent's instance/model/effort flow through as the model selection so
    //    the right provider (at the requested reasoning effort) is invoked.
    const prompt = buildProposalPrompt({ definition: baseDef, metrics });
    const modelSelection: ModelSelectionType = {
      instanceId: input.agent.instance as ModelSelectionType["instanceId"],
      model: input.agent.model,
      ...(input.agent.options === undefined ? {} : { options: input.agent.options }),
    };
    const genExit = yield* textGeneration
      .generateBoardProposal({ prompt, modelSelection })
      .pipe(Effect.exit);
    if (Exit.isFailure(genExit)) {
      const detail = Cause.squash(genExit.cause);
      return yield* invalid(
        `Board proposal generation failed: ${
          detail instanceof Error ? detail.message : String(detail)
        }`,
        failValidation({ messages: ["Generation failed; no proposal was produced."] }),
      );
    }

    const parsedExit = yield* Effect.try({
      try: () => parseBoardProposal(genExit.value),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }).pipe(Effect.exit);
    if (Exit.isFailure(parsedExit)) {
      const detail = Cause.squash(parsedExit.cause);
      return yield* invalid(
        "Board proposal output was malformed.",
        failValidation({ messages: [typeof detail === "string" ? detail : String(detail)] }),
      );
    }
    const parsed = parsedExit.value;
    const rationale = parsed.rationale;

    // 3. Decode the proposed definition.
    const decodeExit = Schema.decodeUnknownExit(WorkflowDefinition)(parsed.proposedDefinition);
    if (Exit.isFailure(decodeExit)) {
      return yield* invalid(
        rationale,
        failValidation({
          messages: ["Proposed definition is structurally invalid and could not be decoded."],
        }),
      );
    }
    const proposedDef = decodeExit.value;

    // 3b. Size cap — BLOCKING (defense-in-depth). A garbage LLM proposal with a
    //     huge lane count would amplify the cost of lint + the lanes×3 dry-run
    //     below; bound it locally (not at the schema level, which would affect
    //     all defs incl. save/import). Reuses dryRunBoard's lane ceiling.
    if (proposedDef.lanes.length > MAX_DRY_RUN_LANES) {
      return yield* invalid(
        rationale,
        failValidation({
          messages: [`Proposed definition has too many lanes (max ${MAX_DRY_RUN_LANES}).`],
        }),
      );
    }
    const proposedDefJson = encodeWorkflowDefinitionJson(proposedDef);

    // 4. Preservation gate (name/sources/outbound + no lane-key removal) — BLOCKING.
    const preservation = preservationGate(baseDef, proposedDef);
    if (!preservation.ok) {
      return yield* invalid(
        rationale,
        failValidation({
          preservationOk: false,
          laneDiffCount: preservation.laneDiffCount,
          messages: preservation.violations,
        }),
      );
    }

    // 5. Strict lint — BLOCKING. Any lint error invalidates the proposal.
    const lintErrors = yield* deps.fileLoader
      .lintDefinition({
        definition: proposedDef,
        projectId: board.projectId as ProjectId,
        workspaceRoot,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("workflow lint failed")));
    if (lintErrors.length > 0) {
      return yield* invalid(
        rationale,
        failValidation({
          preservationOk: true,
          laneDiffCount: preservation.laneDiffCount,
          lintErrors: lintErrors.map(toContractLintError),
          messages: [`Proposed definition has ${lintErrors.length} lint error(s).`],
        }),
      );
    }

    // 6. Dry-run regression — BLOCKING. Run every {lane, scenario} combo on BOTH
    //    base and proposed; a NEW dead end in proposed is a regression.
    const baseResults = yield* dryRunAllCombos(baseDef, predicates);
    const proposedResults = yield* dryRunAllCombos(proposedDef, predicates);
    const regression = dryRunRegression(baseResults, proposedResults);
    if (!regression.ok) {
      return yield* invalid(
        rationale,
        failValidation({
          preservationOk: true,
          lintOk: true,
          laneDiffCount: preservation.laneDiffCount,
          dryRunRegressions: regression.regressions,
          messages: [
            `Proposed definition introduces ${regression.regressions.length} routing regression(s).`,
          ],
        }),
      );
    }

    // 7. All gates pass → pending.
    return yield* finalize({
      status: "pending",
      rationale,
      validation: {
        preservationOk: true,
        lintOk: true,
        dryRunOk: true,
        laneDiffCount: preservation.laneDiffCount,
        lintErrors: [],
        dryRunRegressions: [],
        messages: [],
      },
      proposedDefJson,
    });
  });

/**
 * Create-wizard "agent-assisted" path. A no-tool LLM op drafts a board from the
 * user's free-text description; we FORCE the user's chosen agent into every
 * agent step, FORBID executable step types (script/merge/pullRequest),
 * strict-lint, and return the draft WITHOUT persisting it. The wizard renders
 * the draft for the user to review before a separate create call persists it.
 *
 * Failures along the way (generation, parse, forbidden type, decode, lint) are
 * surfaced as `{ ok: false, ... }` results — NOT RpcErrors — so the wizard
 * dialog can show them. Only the textGeneration-unavailable case uses
 * `workflowRpcError`, matching `proposeBoardImprovement` (a server without the
 * text-generation dep cannot offer this feature at all).
 *
 * Does NOT persist: no board create, no proposal record, no file write.
 */
export const generateWorkflowDraft = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    "projectWorkspaceResolver" | "fileLoader" | "textGeneration" | "predicates"
  >,
  input: WorkflowGenerateWorkflowDraftInputType,
): Effect.Effect<WorkflowGenerateWorkflowDraftResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const textGeneration = deps.textGeneration;
    if (textGeneration === undefined) {
      return yield* workflowRpcError("Workflow draft generation is not available on this server");
    }
    // The dead-end dry-run gate (below) needs a predicate evaluator. A server
    // without one cannot offer this feature, matching proposeBoardImprovement.
    const predicates = deps.predicates;
    if (predicates === undefined) {
      return yield* workflowRpcError("Workflow draft generation is not available on this server");
    }

    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(input.projectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));

    const prompt = buildCreatePrompt({
      name: input.name,
      description: input.description,
      agent: input.agent,
    });
    const modelSelection: ModelSelectionType = {
      instanceId: input.agent.instance as ModelSelectionType["instanceId"],
      model: input.agent.model,
      ...(input.agent.options === undefined ? {} : { options: input.agent.options }),
    };

    const genExit = yield* textGeneration
      .generateBoardProposal({ prompt, modelSelection })
      .pipe(Effect.exit);
    if (Exit.isFailure(genExit)) {
      const detail = Cause.squash(genExit.cause);
      return {
        ok: false,
        message: `Workflow draft generation failed: ${
          detail instanceof Error ? detail.message : String(detail)
        }`,
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    const parsedExit = yield* Effect.try({
      try: () => parseBoardProposal(genExit.value),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }).pipe(Effect.exit);
    if (Exit.isFailure(parsedExit)) {
      const detail = Cause.squash(parsedExit.cause);
      return {
        ok: false,
        message: `Generated draft was malformed: ${
          typeof detail === "string" ? detail : String(detail)
        }`,
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }
    const parsed = parsedExit.value;

    // Raw byte cap BEFORE the expensive raw-pipeline walk (injectAgentIntoSteps
    // loops every lane/step) + decode + lint. A provider can return one lane with
    // tens of thousands of steps that the lane-COUNT guard below would never
    // catch; cap the RAW parsed definition first so the inject walk is bounded.
    // JSON.stringify is wrapped in try/catch because a pathologically deep/
    // circular object can throw before the comparison; treat that as "too large".
    let parsedJsonLength: number;
    // @effect-diagnostics-next-line tryCatchInEffectGen:off — synchronous size probe; not an Effect failure
    try {
      // @effect-diagnostics-next-line preferSchemaOverJson:off — pure size probe, not parsing
      parsedJsonLength = JSON.stringify(parsed.proposedDefinition).length;
    } catch {
      return {
        ok: false,
        message: "Generated board is too large.",
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }
    if (parsedJsonLength > MAX_IMPORT_DEFINITION_CHARS) {
      return {
        ok: false,
        message: "Generated board is too large.",
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    // Force the chosen agent into every agent step on the RAW parsed object,
    // BEFORE decode — an LLM draft whose agent step omits `agent` is FIXED here,
    // not rejected by the schema. Bounded: the byte cap above already capped the
    // step count this walk iterates.
    const injected = injectAgentIntoSteps(parsed.proposedDefinition, input.agent);

    // The user's Step-1 board name is authoritative; overwrite whatever name the
    // model emitted so the returned draft (and any board later created from it)
    // carries the user's chosen name. Done on the RAW object before decode.
    if (typeof injected === "object" && injected !== null && !Array.isArray(injected)) {
      (injected as { name?: unknown }).name = input.name;
    }

    if (containsForbiddenStepType(injected)) {
      return {
        ok: false,
        message: "Generated board contains a forbidden step type (script/merge/pullRequest).",
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    const decodeExit = Schema.decodeUnknownExit(WorkflowDefinition)(injected);
    if (Exit.isFailure(decodeExit)) {
      // Surface the specific schema violation (e.g. `Expected "auto" | "manual",
      // got "automatic" at ["lanes"][0]["entry"]`) so the user can see WHY the
      // draft was rejected and regenerate — an opaque "invalid" message is
      // undebuggable. The SchemaError message is concise and path-specific; cap
      // it so a pathological draft can't return an unbounded message.
      const detail = Cause.squash(decodeExit.cause);
      const reason = (detail instanceof Error ? detail.message : String(detail))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      return {
        ok: false,
        message: `Generated definition is structurally invalid: ${reason}`,
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }
    const decoded = decodeExit.value;

    // Size cap — defense-in-depth. The schema has no maxItems, so a runaway LLM
    // draft with thousands of lanes would decode fine and flow into lint
    // unbounded (cost amplification). Bound it before lint, mirroring
    // proposeBoardImprovement.
    if (decoded.lanes.length > MAX_DRY_RUN_LANES) {
      return {
        ok: false,
        message: `Generated board has too many lanes (max ${MAX_DRY_RUN_LANES}).`,
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    // Per-lane caps — the lane-COUNT guard above does not bound a single lane's
    // pipeline/transitions/onEvent count. A runaway lane would still amplify
    // lint + the dead-end dry-run below; bound it here.
    if (
      decoded.lanes.some(
        (lane) =>
          (lane.pipeline?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.transitions?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.onEvent?.length ?? 0) > MAX_IMPORT_PER_LANE,
      )
    ) {
      return {
        ok: false,
        message: "Generated board has a lane that is too large.",
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    const lintErrors = yield* deps.fileLoader
      .lintDefinition({ definition: decoded, projectId: input.projectId, workspaceRoot })
      .pipe(Effect.mapError(toWorkflowRpcError("workflow lint failed")));
    if (lintErrors.length > 0) {
      return {
        ok: false,
        lintErrors: lintErrors.map(toContractLintError),
        message: "Generated board failed validation.",
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    // Dead-end dry-run gate. lint does NOT check terminal reachability
    // (`unreachable_terminal` is declared but unimplemented), so a board can
    // pass lint yet strand tickets in a lane with no route out. Reject those.
    const deadEndLanes = yield* dryRunDeadEndLanes(decoded, predicates);
    if (deadEndLanes.length > 0) {
      return {
        ok: false,
        message: strandingMessage(deadEndLanes),
      } satisfies WorkflowGenerateWorkflowDraftResult;
    }

    return {
      ok: true,
      definition: encodeWorkflowDefinition(decoded),
      rationale: parsed.rationale,
    } satisfies WorkflowGenerateWorkflowDraftResult;
  });

/**
 * List all proposals for a board. Exported for direct testing and for E8 to
 * register in the WS RPC group once it declares the method.
 */
export const listBoardProposals = (
  deps: Pick<WorkflowRpcHandlerDeps, "readModel">,
  input: WorkflowListBoardProposalsInputType,
): Effect.Effect<WorkflowListBoardProposalsResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const proposals = yield* deps.readModel
      .listBoardProposals(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to list board proposals")));
    return { proposals: [...proposals] } satisfies WorkflowListBoardProposalsResult;
  });

/**
 * Get a single proposal by proposalId (view + both encoded defs). Exported for
 * direct testing and for E8 to register in the WS RPC group.
 */
export const getBoardProposal = (
  deps: Pick<WorkflowRpcHandlerDeps, "readModel">,
  input: WorkflowGetBoardProposalInputType,
): Effect.Effect<WorkflowGetBoardProposalResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const result = yield* deps.readModel
      .getBoardProposal(input.proposalId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load board proposal")));
    if (result === null) {
      return yield* workflowRpcError(`Board proposal ${input.proposalId} was not found`);
    }
    return {
      proposal: result.view,
      proposedDefinition: result.proposedDefinition,
      baseDefinition: result.baseDefinition,
    } satisfies WorkflowGetBoardProposalResult;
  });

/**
 * Live-compatibility gate for resolve-approve. Returns the keys of lanes whose
 * DEFINITION DIFFERS between base and proposed AND currently hold live work
 * (a non-terminal admitted ticket OR a running pipeline). Applying a proposal
 * that restructures such a lane could disrupt in-flight work, so those lanes
 * block the apply.
 *
 * Only MODIFIED lanes matter: an unchanged lane (even if occupied) is fine, and
 * a modified lane that is idle/empty is fine. The intersection is
 * (changed lanes) × (live-occupied lanes).
 */
const liveIncompatibleLanes = (
  deps: Pick<WorkflowRpcHandlerDeps, "readModel">,
  boardId: BoardId,
  baseDef: WorkflowDefinitionEncoded,
  proposedDef: WorkflowDefinitionEncoded,
): Effect.Effect<ReadonlyArray<string>, WorkflowRpcError> =>
  Effect.gen(function* () {
    // Canonical per-lane serialization keyed by lane key. The defs are decoded
    // then re-encoded by getBoardProposal, so JSON.stringify is stable.
    const laneJsonByKey = (def: WorkflowDefinitionEncoded) => {
      const map = new Map<string, string>();
      for (const lane of def.lanes) {
        map.set(lane.key as string, JSON.stringify(lane));
      }
      return map;
    };
    const baseLanes = laneJsonByKey(baseDef);
    const proposedLanes = laneJsonByKey(proposedDef);

    // A lane is "changed" when its serialized form differs across base/proposed.
    // (E4 forbids removing/renaming a lane key, so a key present in base always
    // remains; a key only in proposed is new and cannot already hold live work.)
    const changedLaneKeys = new Set<string>();
    for (const [key, baseJson] of baseLanes) {
      const proposedJson = proposedLanes.get(key);
      if (proposedJson === undefined || proposedJson !== baseJson) {
        changedLaneKeys.add(key);
      }
    }
    if (changedLaneKeys.size === 0) {
      return [];
    }

    const occupied = yield* deps.readModel
      .listLiveOccupiedLanes(boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to inspect live lane occupancy")));
    const occupiedSet = new Set(occupied);

    const incompatible: Array<string> = [];
    for (const key of changedLaneKeys) {
      if (occupiedSet.has(key)) {
        incompatible.push(key);
      }
    }
    return incompatible;
  });

/**
 * Apply-time RE-VALIDATION (preservation + dry-run) using the CURRENT validator
 * code. Proposal-time validation may have run under older/weaker code, and
 * `saveBoardDefinition` only re-runs lint — not preservation or dry-run. So at
 * approve we re-run both gates against the proposed def: if either fails NOW the
 * proposal is no longer applicable. Returns `null` when both pass, or a failure
 * `{reason, message}` to surface + mark the proposal `invalid`.
 *
 * Requires `predicates` for the dry-run; when absent (server without proposals)
 * the re-validation is skipped (apply still cannot be reached without it).
 */
const revalidateProposalForApply = (
  deps: Pick<WorkflowRpcHandlerDeps, "predicates">,
  baseDef: WorkflowDefinitionType,
  proposedDef: WorkflowDefinitionType,
): Effect.Effect<{ readonly message: string } | null, WorkflowRpcError> =>
  Effect.gen(function* () {
    // Preservation (name/sources/outbound + no lane-key removal) — BLOCKING.
    const preservation = preservationGate(baseDef, proposedDef);
    if (!preservation.ok) {
      return {
        message: `this proposal no longer passes preservation checks: ${preservation.violations.join("; ")}`,
      };
    }

    const predicates = deps.predicates;
    if (predicates === undefined) {
      // No evaluator available; we cannot re-run the dry-run. Preservation passed.
      return null;
    }

    // Dry-run regression — BLOCKING. A NEW dead end in proposed is a regression.
    const baseResults = yield* dryRunAllCombos(baseDef, predicates);
    const proposedResults = yield* dryRunAllCombos(proposedDef, predicates);
    const regression = dryRunRegression(baseResults, proposedResults);
    if (!regression.ok) {
      return {
        message: `this proposal now introduces routing regression(s): ${regression.regressions.join("; ")}`,
      };
    }
    return null;
  });

/**
 * `resolveBoardProposal` — apply (approve) or dismiss (reject) a board-improvement
 * proposal. This is the SOLE path that writes a board definition from a proposal:
 * the propose/list/get paths never call `saveBoardDefinition`, and neither does
 * reject. Approve is gated by optimistic concurrency (the proposal's
 * base_version_hash must still be the board's current version), a re-run of the
 * preservation + dry-run validators with CURRENT code, and a live-ticket
 * compatibility check (a modified lane holding in-flight work blocks the apply).
 *
 * The gate-check + saveBoardDefinition + status flip run INSIDE the board
 * ADMISSION lock (OUTER) wrapping the save lock (INNER, taken by
 * saveBoardDefinition). The admission lock — not the save lock — serializes WIP
 * admission, so without it a ticket could enter a changed lane between the
 * live-gate and the write (TOCTOU). Holding it across the whole region closes
 * that window; reject takes the same lock so it cannot flip a proposal mid-apply.
 * All status transitions run under a DB transaction in the read model.
 *
 * Apply-state durability invariant: once the board file IS the proposed def
 * (save succeeded), the proposal MUST be `approved` (revertable) — never left
 * pending/rejected/superseded. After the save we mark approved unconditionally;
 * if a concurrent reject/supersede slipped the row out of `pending` (affected
 * count 0), we RECONCILE by forcing it back to `approved`.
 *
 * Exported for direct testing and for E8 to register against the WS RPC group.
 */
export const resolveBoardProposal = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "readModel"
    | "engine"
    | "boardRegistry"
    | "projectWorkspaceResolver"
    | "fileLoader"
    | "workspaceFileSystem"
    | "saveLocks"
    | "versionStore"
    | "predicates"
  >,
  input: WorkflowResolveBoardProposalInputType,
): Effect.Effect<WorkflowResolveBoardProposalResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const loaded = yield* deps.readModel
      .getBoardProposal(input.proposalId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load board proposal")));
    if (loaded === null) {
      return {
        ok: false,
        reason: "invalid",
        message: `Board proposal ${input.proposalId} was not found`,
      } satisfies WorkflowResolveBoardProposalResult;
    }

    const { view, proposedDefinition, baseDefinition } = loaded;
    const boardId = view.boardId as BoardId;

    // Non-pending proposals are not actionable. Returning ok:true here would tell
    // the UI the action applied; instead report it is no longer approvable.
    if (view.status !== "pending") {
      const verb = input.action === "reject" ? "rejectable" : "approvable";
      return {
        ok: false,
        reason: "invalid",
        message: `this proposal is no longer ${verb} (status "${view.status}")`,
      } satisfies WorkflowResolveBoardProposalResult;
    }

    const resolvedAt = DateTime.formatIso(yield* DateTime.now);

    // ── reject ──────────────────────────────────────────────────────────────
    // Reject takes the admission lock too, so it cannot flip a proposal out of
    // `pending` while an approve is mid-save (which would orphan an applied board
    // change as a non-approved row).
    if (input.action === "reject") {
      return yield* deps.engine.withBoardAdmissionLock(
        boardId,
        Effect.gen(function* () {
          const affected = yield* deps.readModel
            .resolveBoardProposalStatus({
              proposalId: input.proposalId,
              status: "rejected",
              resolvedAt,
              fromStatus: "pending",
            })
            .pipe(Effect.mapError(toWorkflowRpcError("Failed to reject board proposal")));
          // Lost a race against a concurrent resolve — no longer rejectable.
          if (affected === 0) {
            return {
              ok: false,
              reason: "invalid",
              message: "this proposal is no longer rejectable (it was resolved concurrently)",
            } satisfies WorkflowResolveBoardProposalResult;
          }
          return {
            ok: true,
            proposal: { ...view, status: "rejected", resolvedAt },
          } satisfies WorkflowResolveBoardProposalResult;
        }),
      );
    }

    // ── approve ─────────────────────────────────────────────────────────────
    // 1. Optimistic concurrency: the board must not have changed since this
    //    proposal was generated (its base_version_hash vs the CURRENT hash).
    if (view.outdated) {
      yield* deps.readModel
        .resolveBoardProposalStatus({
          proposalId: input.proposalId,
          status: "superseded",
          resolvedAt,
          fromStatus: "pending",
        })
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to supersede board proposal")));
      return {
        ok: false,
        reason: "conflict",
        message: "the board changed since this proposal — re-run",
      } satisfies WorkflowResolveBoardProposalResult;
    }

    // 2. RE-VALIDATE with current code (preservation + dry-run). A pending
    //    proposal generated under older/weaker validators must still pass NOW.
    const baseDefDecoded = yield* decodeWorkflowDefinition(baseDefinition).pipe(
      Effect.mapError(toWorkflowRpcError("Failed to decode proposal base definition")),
    );
    const proposedDefDecoded = yield* decodeWorkflowDefinition(proposedDefinition).pipe(
      Effect.mapError(toWorkflowRpcError("Failed to decode proposal proposed definition")),
    );
    const revalidation = yield* revalidateProposalForApply(
      deps,
      baseDefDecoded,
      proposedDefDecoded,
    );
    if (revalidation !== null) {
      yield* deps.readModel
        .resolveBoardProposalStatus({
          proposalId: input.proposalId,
          status: "invalid",
          resolvedAt,
          fromStatus: "pending",
        })
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to invalidate board proposal")));
      return {
        ok: false,
        reason: "invalid",
        message: revalidation.message,
      } satisfies WorkflowResolveBoardProposalResult;
    }

    // 3-5. Live-gate + save + status flip, all INSIDE the admission lock (OUTER)
    //      so no ticket can enter a changed lane between the gate and the write.
    //      saveBoardDefinition takes the save lock (INNER) — never invert.
    return yield* deps.engine.withBoardAdmissionLock(
      boardId,
      Effect.gen(function* () {
        // Live-compatibility gate: a modified lane holding in-flight work blocks
        // the apply. The proposal stays pending; saveBoardDefinition is NOT called.
        const incompatible = yield* liveIncompatibleLanes(
          deps,
          boardId,
          baseDefinition,
          proposedDefinition,
        );
        if (incompatible.length > 0) {
          return {
            ok: false,
            reason: "live_tickets",
            message: `applying this would disrupt in-flight work in lane(s): ${incompatible.join(", ")} — let them finish or move them, then approve`,
          } satisfies WorkflowResolveBoardProposalResult;
        }

        // Apply via the SOLE saveBoardDefinition call. expectedVersionHash is the
        // proposal's base_version_hash so a stale proposal conflicts (and is
        // superseded) rather than clobbering newer changes.
        const saveResult = yield* saveBoardDefinition(deps, {
          boardId,
          definition: proposedDefinition,
          expectedVersionHash: view.baseVersionHash,
          source: "self-improve",
        });

        if (saveResult.ok === false && "conflict" in saveResult) {
          yield* deps.readModel
            .resolveBoardProposalStatus({
              proposalId: input.proposalId,
              status: "superseded",
              resolvedAt,
              fromStatus: "pending",
            })
            .pipe(Effect.mapError(toWorkflowRpcError("Failed to supersede board proposal")));
          return {
            ok: false,
            reason: "conflict",
            message: "the board changed since this proposal — re-run",
          } satisfies WorkflowResolveBoardProposalResult;
        }

        if (saveResult.ok === false) {
          // lintErrors — leave the proposal pending so it can be re-examined.
          return {
            ok: false,
            reason: "lint",
            message: "the proposed definition failed lint",
            lintErrors: saveResult.lintErrors,
          } satisfies WorkflowResolveBoardProposalResult;
        }

        // SAVE SUCCEEDED → the board file IS the proposed def. The apply-state
        // durability invariant requires the proposal be `approved` (revertable)
        // from here on. Mark approved + record applied_version_hash.
        const affected = yield* deps.readModel
          .resolveBoardProposalStatus({
            proposalId: input.proposalId,
            status: "approved",
            resolvedAt,
            appliedVersionHash: saveResult.versionHash,
            fromStatus: "pending",
          })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to mark board proposal approved")));

        // RECONCILE: if a concurrent reject/supersede slipped the row out of
        // `pending` after we wrote the board (affected 0), force it to `approved`
        // — the board change is live, so revert must stay available. Reject takes
        // the admission lock so this is near-impossible, but the forced write
        // closes the residual window deterministically.
        if (affected === 0) {
          yield* deps.readModel
            .resolveBoardProposalStatus({
              proposalId: input.proposalId,
              status: "approved",
              resolvedAt,
              appliedVersionHash: saveResult.versionHash,
            })
            .pipe(
              Effect.mapError(toWorkflowRpcError("Failed to reconcile board proposal to approved")),
            );
        }

        return {
          ok: true,
          proposal: {
            ...view,
            status: "approved",
            resolvedAt,
            appliedVersionHash: saveResult.versionHash,
          },
        } satisfies WorkflowResolveBoardProposalResult;
      }),
    );
  });

/**
 * `revertBoardProposal` — one-click rollback of an APPLIED improvement.
 *
 * Restores the proposal's retained `base_def_json` (the definition that was
 * in effect before the improvement was applied) so a not-working-out
 * improvement can be undone. Reuses E6's `saveBoardDefinition` / live-gate /
 * `resolveBoardProposalStatus` helpers under the same concurrency model.
 *
 * Only valid for a proposal in `approved` status (already applied).
 * The board-changed-since-apply guard: the board's current versionHash must
 * equal `applied_version_hash` stored on the proposal — if it differs, someone
 * edited the board after the improvement was applied and we refuse to silently
 * discard those later changes.
 *
 * Exported for direct testing; E8 registers it against the WS RPC group.
 */
export const revertBoardProposal = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "readModel"
    | "engine"
    | "boardRegistry"
    | "projectWorkspaceResolver"
    | "fileLoader"
    | "workspaceFileSystem"
    | "saveLocks"
    | "versionStore"
  >,
  input: WorkflowRevertBoardProposalInputType,
): Effect.Effect<WorkflowRevertBoardProposalResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const loaded = yield* deps.readModel
      .getBoardProposal(input.proposalId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load board proposal")));
    if (loaded === null) {
      return {
        ok: false,
        reason: "invalid",
        message: `Board proposal ${input.proposalId} was not found`,
      } satisfies WorkflowRevertBoardProposalResult;
    }

    const { view, proposedDefinition, baseDefinition } = loaded;
    const boardId = view.boardId as BoardId;

    // Only an `approved` (applied) proposal can be reverted. Any other status is
    // not actionable → ok:false (never ok:true, which would close the UI as done).
    if (view.status !== "approved") {
      return {
        ok: false,
        reason: "invalid",
        message: `this proposal is no longer revertable (status "${view.status}"); only an applied (approved) proposal can be reverted`,
      } satisfies WorkflowRevertBoardProposalResult;
    }

    // Board-changed-since-apply guard: the board's current hash must equal
    // the hash recorded at apply time. If it differs, subsequent edits happened
    // after the improvement and reverting would silently discard them.
    const board = yield* deps.readModel
      .getBoard(boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${boardId} was not found`);
    }
    if (board.workflowVersionHash !== view.appliedVersionHash) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "the board changed since this improvement was applied — reverting would discard those changes; revert manually via version history",
      } satisfies WorkflowRevertBoardProposalResult;
    }

    // Live-gate + save + status flip, all INSIDE the admission lock (OUTER) so no
    // ticket can enter a changed lane between the gate and the write.
    // saveBoardDefinition takes the save lock (INNER) — never invert.
    return yield* deps.engine.withBoardAdmissionLock(
      boardId,
      Effect.gen(function* () {
        // Live-compatibility gate: compare proposed (currently live) vs base
        // (target after revert). If a lane the improvement CHANGED now holds live
        // work, reverting it would disrupt in-flight work.
        const incompatible = yield* liveIncompatibleLanes(
          deps,
          boardId,
          proposedDefinition,
          baseDefinition,
        );
        if (incompatible.length > 0) {
          return {
            ok: false,
            reason: "live_tickets",
            message: `reverting this would disrupt in-flight work in lane(s): ${incompatible.join(", ")} — let them finish or move them, then revert`,
          } satisfies WorkflowRevertBoardProposalResult;
        }

        // Apply the revert: write base_def_json back.  expectedVersionHash is the
        // CURRENT board hash (= applied_version_hash, confirmed above) so a
        // concurrent edit between the guard and the write still conflicts safely.
        const saveResult = yield* saveBoardDefinition(deps, {
          boardId,
          definition: baseDefinition,
          expectedVersionHash: board.workflowVersionHash,
          source: "self-improve-revert",
        });

        if (saveResult.ok === false && "conflict" in saveResult) {
          return {
            ok: false,
            reason: "conflict",
            message:
              "the board changed since this improvement was applied — revert manually via version history",
          } satisfies WorkflowRevertBoardProposalResult;
        }

        if (saveResult.ok === false) {
          // Lint on the base definition — should never happen (it linted before),
          // but handle defensively to keep the shape exhaustive.
          return {
            ok: false,
            reason: "lint",
            message: "the base definition failed lint during revert (unexpected)",
            lintErrors: saveResult.lintErrors,
          } satisfies WorkflowRevertBoardProposalResult;
        }

        // SAVE SUCCEEDED → the board file IS the base def again. Mark reverted;
        // if a concurrent transition raced the row out of `approved`, force it
        // (the board is rolled back, so the row must reflect `reverted`).
        const resolvedAt = DateTime.formatIso(yield* DateTime.now);
        const affected = yield* deps.readModel
          .resolveBoardProposalStatus({
            proposalId: input.proposalId,
            status: "reverted",
            resolvedAt,
            fromStatus: "approved",
          })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to mark board proposal reverted")));
        if (affected === 0) {
          yield* deps.readModel
            .resolveBoardProposalStatus({
              proposalId: input.proposalId,
              status: "reverted",
              resolvedAt,
            })
            .pipe(
              Effect.mapError(toWorkflowRpcError("Failed to reconcile board proposal to reverted")),
            );
        }

        return {
          ok: true,
          proposal: {
            ...view,
            status: "reverted",
            resolvedAt,
          },
        } satisfies WorkflowRevertBoardProposalResult;
      }),
    );
  });

const toBoardVersionSummary = (
  version: WorkflowBoardVersionSummaryRow,
  index: number,
): WorkflowBoardVersionSummary => ({
  versionId: version.versionId,
  versionHash: version.versionHash,
  source: version.source,
  createdAt: version.createdAt,
  isCurrent: index === 0,
});

const backfillImportedBoardVersion = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    "readModel" | "projectWorkspaceResolver" | "workspaceFileSystem" | "versionStore"
  >,
  boardId: BoardId,
): Effect.Effect<void, WorkflowRpcError> =>
  Effect.gen(function* () {
    const board = yield* deps.readModel
      .getBoard(boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${boardId} was not found`);
    }

    const projectId = board.projectId as ProjectId;
    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(projectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));
    const contentJson = yield* deps.workspaceFileSystem
      .readFileString({
        cwd: workspaceRoot,
        relativePath: board.workflowFilePath,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to read workflow board file")));
    const versionHash = sha256Hex(contentJson);
    if (versionHash !== board.workflowVersionHash) {
      yield* Effect.logWarning("Skipping workflow board version import for stale projection", {
        boardId,
        projectedVersionHash: board.workflowVersionHash,
        fileVersionHash: versionHash,
      });
      return;
    }

    yield* deps.versionStore
      .record({
        boardId,
        versionHash,
        contentJson,
        source: "import",
      })
      .pipe(
        Effect.mapError(toWorkflowRpcError("Failed to record imported workflow board version")),
      );
  });

const listBoardVersions = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    "readModel" | "projectWorkspaceResolver" | "workspaceFileSystem" | "versionStore" | "saveLocks"
  >,
  input: WorkflowGetBoardDefinitionInput,
): Effect.Effect<ReadonlyArray<WorkflowBoardVersionSummary>, WorkflowRpcError> =>
  Effect.gen(function* () {
    const existing = yield* deps.versionStore
      .list(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to list workflow board versions")));
    if (existing.length > 0) {
      return existing.map(toBoardVersionSummary);
    }

    yield* (deps.saveLocks?.withSaveLock ?? ((_boardId, effect) => effect))(
      input.boardId,
      Effect.gen(function* () {
        const lockedExisting = yield* deps.versionStore
          .list(input.boardId)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to list workflow board versions")));
        if (lockedExisting.length > 0) {
          return;
        }
        yield* backfillImportedBoardVersion(deps, input.boardId);
      }),
    );
    const imported = yield* deps.versionStore
      .list(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to list workflow board versions")));
    return imported.map(toBoardVersionSummary);
  });

const getBoardVersion = (
  deps: Pick<WorkflowRpcHandlerDeps, "versionStore">,
  input: WorkflowGetBoardVersionInput,
): Effect.Effect<WorkflowGetBoardVersionResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    const version = yield* deps.versionStore
      .get(input.boardId, input.versionId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board version")));
    if (!version) {
      return yield* workflowRpcError(
        `Workflow board version ${input.versionId} was not found for board ${input.boardId}`,
      );
    }

    const definition = yield* decodeWorkflowDefinitionJson(version.contentJson).pipe(
      Effect.mapError(toWorkflowRpcError("workflow board version decode failed")),
    );
    return {
      versionId: version.versionId,
      definition: encodeWorkflowDefinition(definition),
      versionHash: version.versionHash,
      source: version.source,
      createdAt: version.createdAt,
    };
  });

interface WritableWorkflowBoardFile {
  readonly board: BoardRow;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly currentRaw: string;
}

interface PersistedWorkflowBoardDefinition {
  readonly _tag: "persisted";
  readonly definition: WorkflowDefinitionEncoded;
  readonly versionHash: string;
  readonly contentJson: string;
}

interface WorkflowBoardDefinitionLintFailure {
  readonly _tag: "lintErrors";
  readonly lintErrors: ReadonlyArray<WorkflowLintError>;
}

type PersistWorkflowBoardDefinitionResult =
  | PersistedWorkflowBoardDefinition
  | WorkflowBoardDefinitionLintFailure;

const loadWritableWorkflowBoardFile = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    "readModel" | "projectWorkspaceResolver" | "workspaceFileSystem"
  >,
  boardId: BoardId,
): Effect.Effect<WritableWorkflowBoardFile, WorkflowRpcError> =>
  Effect.gen(function* () {
    const board = yield* deps.readModel
      .getBoard(boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
    if (!board) {
      return yield* workflowRpcError(`Workflow board ${boardId} was not found`);
    }

    if (!WORKFLOW_BOARD_FILE_PATH_PATTERN.test(board.workflowFilePath)) {
      return yield* workflowRpcError(
        `Workflow board ${boardId} is not a writable workflow board file`,
      );
    }

    const projectId = board.projectId as ProjectId;
    const workspaceRoot = yield* deps.projectWorkspaceResolver
      .resolve(projectId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow project root")));
    const currentRaw = yield* deps.workspaceFileSystem
      .readFileString({
        cwd: workspaceRoot,
        relativePath: board.workflowFilePath,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to read workflow board file")));

    return {
      board,
      projectId,
      workspaceRoot,
      currentRaw,
    };
  });

const persistWorkflowBoardDefinition = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    "readModel" | "fileLoader" | "workspaceFileSystem" | "versionStore"
  >,
  input: {
    readonly boardId: BoardId;
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly definition: WorkflowDefinitionType;
    readonly source: WorkflowBoardVersionSource;
    readonly notFoundAfterWriteMessage: string;
    readonly versionRecording?: "best-effort" | "required";
  },
): Effect.Effect<PersistWorkflowBoardDefinitionResult, WorkflowRpcError> =>
  Effect.gen(function* () {
    // DoS backstop: bound the definition before the expensive lint + load,
    // mirroring the import caps. A legitimate edited board is far below these
    // generous ceilings; this stops an operate-scoped client from persisting an
    // arbitrarily large definition. The def is already decoded, so stringify is
    // safe (no circular refs). (PR review: the save path previously had no caps.)
    const contentJson = workflowDefinitionContentJson(input.definition);
    const tooLarge = (message: string): PersistWorkflowBoardDefinitionResult => ({
      _tag: "lintErrors",
      lintErrors: [{ code: "invalid_step", message }],
    });
    if (contentJson.length > MAX_IMPORT_DEFINITION_CHARS) {
      return tooLarge(
        `Board definition is too large to save (exceeds ${MAX_IMPORT_DEFINITION_CHARS} characters)`,
      );
    }
    if (input.definition.lanes.length > MAX_IMPORT_LANES) {
      return tooLarge(`Board definition is too large to save (exceeds ${MAX_IMPORT_LANES} lanes)`);
    }
    if (
      input.definition.lanes.some(
        (lane) =>
          (lane.pipeline?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.transitions?.length ?? 0) > MAX_IMPORT_PER_LANE ||
          (lane.onEvent?.length ?? 0) > MAX_IMPORT_PER_LANE,
      )
    ) {
      return tooLarge(
        `Board definition is too large to save (a lane exceeds ${MAX_IMPORT_PER_LANE} pipeline steps, transitions, or event handlers)`,
      );
    }

    const lintErrors = yield* deps.fileLoader
      .lintDefinition({
        definition: input.definition,
        projectId: input.projectId,
        workspaceRoot: input.workspaceRoot,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("workflow lint failed")));
    if (lintErrors.length > 0) {
      return { _tag: "lintErrors", lintErrors: lintErrors.map(toContractLintError) };
    }

    yield* deps.workspaceFileSystem
      .writeFile({
        cwd: input.workspaceRoot,
        relativePath: input.relativePath,
        contents: contentJson,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to write workflow board file")));

    yield* deps.fileLoader
      .loadAndRegister({
        boardId: input.boardId,
        projectId: input.projectId,
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
      })
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to register saved workflow board")));

    const updatedBoard = yield* deps.readModel
      .getBoard(input.boardId)
      .pipe(Effect.mapError(toWorkflowRpcError("Failed to load saved workflow board")));
    if (!updatedBoard) {
      return yield* workflowRpcError(input.notFoundAfterWriteMessage);
    }
    const versionRecordInput = {
      boardId: input.boardId,
      versionHash: updatedBoard.workflowVersionHash,
      contentJson,
      source: input.source,
    };
    if (input.versionRecording === "required") {
      yield* recordBoardVersionRequired(deps, versionRecordInput);
    } else {
      yield* recordBoardVersionBestEffort(deps, versionRecordInput);
    }

    return {
      _tag: "persisted",
      definition: encodeWorkflowDefinition(input.definition),
      versionHash: updatedBoard.workflowVersionHash,
      contentJson,
    };
  });

const saveBoardDefinition = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "readModel"
    | "boardRegistry"
    | "projectWorkspaceResolver"
    | "fileLoader"
    | "workspaceFileSystem"
    | "saveLocks"
    | "versionStore"
  >,
  input: WorkflowSaveBoardDefinitionInput,
): Effect.Effect<WorkflowSaveBoardDefinitionResult, WorkflowRpcError> =>
  (deps.saveLocks?.withSaveLock ?? ((_boardId, effect) => effect))(
    input.boardId,
    Effect.gen(function* () {
      const definition = yield* decodeWorkflowDefinition(input.definition).pipe(
        Effect.mapError(toWorkflowRpcError("workflow definition decode failed")),
      );
      const boardFile = yield* loadWritableWorkflowBoardFile(deps, input.boardId);
      const currentVersionHash = sha256Hex(boardFile.currentRaw);
      if (currentVersionHash !== input.expectedVersionHash) {
        return {
          ok: false,
          conflict: true,
          currentVersionHash,
        };
      }

      const persisted = yield* persistWorkflowBoardDefinition(deps, {
        boardId: input.boardId,
        projectId: boardFile.projectId,
        workspaceRoot: boardFile.workspaceRoot,
        relativePath: boardFile.board.workflowFilePath,
        definition,
        source: input.source ?? "save",
        notFoundAfterWriteMessage: `Workflow board ${input.boardId} was not found after save`,
      });
      if (persisted._tag === "lintErrors") {
        return { ok: false, lintErrors: persisted.lintErrors };
      }

      const snapshot = yield* boardSnapshot(deps, input.boardId);
      return {
        ok: true,
        definition: persisted.definition,
        versionHash: persisted.versionHash,
        snapshot,
      };
    }),
  );

const renameBoard = (
  deps: Pick<
    WorkflowRpcHandlerDeps,
    | "readModel"
    | "boardRegistry"
    | "projectWorkspaceResolver"
    | "fileLoader"
    | "workspaceFileSystem"
    | "saveLocks"
    | "versionStore"
  >,
  input: WorkflowRenameBoardHandlerInput,
): Effect.Effect<void, WorkflowRpcError> =>
  decodeWorkflowRenameBoardInput(input).pipe(
    Effect.mapError(toWorkflowRpcError("workflow board rename input decode failed")),
    Effect.flatMap((decoded) =>
      (deps.saveLocks?.withSaveLock ?? ((_boardId, effect) => effect))(
        decoded.boardId,
        Effect.gen(function* () {
          const boardFile = yield* loadWritableWorkflowBoardFile(deps, decoded.boardId);
          const currentDefinition = yield* decodeWorkflowDefinitionJson(boardFile.currentRaw).pipe(
            Effect.mapError(toWorkflowRpcError("workflow board file decode failed")),
          );
          if (currentDefinition.name === decoded.name) {
            const fileVersionHash = sha256Hex(boardFile.currentRaw);
            const registeredDefinition = yield* deps.boardRegistry.getDefinition(decoded.boardId);
            const registeredDefinitionHash =
              registeredDefinition === null
                ? null
                : workflowDefinitionVersionHash(registeredDefinition);
            const currentDefinitionHash = workflowDefinitionVersionHash(currentDefinition);
            const versions = yield* deps.versionStore
              .list(decoded.boardId)
              .pipe(Effect.mapError(toWorkflowRpcError("Failed to list workflow board versions")));
            const projectionIsCurrent = boardFile.board.workflowVersionHash === fileVersionHash;
            const registryIsCurrent = registeredDefinitionHash === currentDefinitionHash;
            const historyIsCurrent = versions[0]?.versionHash === fileVersionHash;
            if (projectionIsCurrent && registryIsCurrent && historyIsCurrent) {
              return;
            }

            if (!projectionIsCurrent || !registryIsCurrent) {
              yield* deps.fileLoader
                .loadAndRegister({
                  boardId: decoded.boardId,
                  projectId: boardFile.projectId,
                  workspaceRoot: boardFile.workspaceRoot,
                  relativePath: boardFile.board.workflowFilePath,
                })
                .pipe(
                  Effect.mapError(toWorkflowRpcError("Failed to register saved workflow board")),
                );

              const updatedBoard = yield* deps.readModel
                .getBoard(decoded.boardId)
                .pipe(Effect.mapError(toWorkflowRpcError("Failed to load saved workflow board")));
              if (!updatedBoard) {
                return yield* workflowRpcError(
                  `Workflow board ${decoded.boardId} was not found after rename`,
                );
              }
            }

            if (!historyIsCurrent) {
              yield* recordBoardVersionRequired(deps, {
                boardId: decoded.boardId,
                versionHash: fileVersionHash,
                contentJson: boardFile.currentRaw,
                source: "rename",
              });
            }
            return;
          }

          const persisted = yield* persistWorkflowBoardDefinition(deps, {
            boardId: decoded.boardId,
            projectId: boardFile.projectId,
            workspaceRoot: boardFile.workspaceRoot,
            relativePath: boardFile.board.workflowFilePath,
            definition: { ...currentDefinition, name: decoded.name },
            source: "rename",
            notFoundAfterWriteMessage: `Workflow board ${decoded.boardId} was not found after rename`,
            versionRecording: "required",
          });
          if (persisted._tag === "lintErrors") {
            return yield* workflowRpcError(
              `Workflow lint failed: ${persisted.lintErrors.map((error) => error.code).join(", ")}`,
            );
          }
        }),
      ),
    ),
  );

/**
 * List the board templates the create-workflow wizard offers. A pure mapping
 * over the static registry — exported for direct testing and for a later task
 * to register in the WS RPC group.
 */
export const listBoardTemplates = (): Effect.Effect<
  WorkflowListBoardTemplatesResult,
  WorkflowRpcError
> =>
  Effect.succeed({
    templates: [...listBoardTemplateSummaries()],
  } satisfies WorkflowListBoardTemplatesResult);

export const workflowRpcHandlers = (deps: WorkflowRpcHandlerDeps) => ({
  [WORKFLOW_WS_METHODS.listBoards]: (input: { readonly projectId: ProjectId }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.listBoards,
      deps.boardDiscovery.discover(input.projectId),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.createBoard]: (input: WorkflowCreateBoardHandlerInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.createBoard, createBoard(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.importBoard]: (input: WorkflowImportBoardInputType) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.importBoard, importBoard(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.createWorkflowBoard]: (input: WorkflowCreateWorkflowBoardInputType) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.createWorkflowBoard,
      createWorkflowBoard(deps, input),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.generateWorkflowDraft]: (input: WorkflowGenerateWorkflowDraftInputType) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.generateWorkflowDraft,
      generateWorkflowDraft(deps, input),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.listBoardTemplates]: (_input: Record<string, never>) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.listBoardTemplates, listBoardTemplates(), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.deleteBoard]: (input: WorkflowDeleteBoardInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.deleteBoard, deleteBoard(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.renameBoard]: (input: WorkflowRenameBoardHandlerInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.renameBoard, renameBoard(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.getBoard]: (input: { readonly boardId: BoardId }) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.getBoard, boardSnapshot(deps, input.boardId), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.getBoardDefinition]: (input: WorkflowGetBoardDefinitionInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.getBoardDefinition, getBoardDefinition(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.saveBoardDefinition]: (input: WorkflowSaveBoardDefinitionInput) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.saveBoardDefinition,
      saveBoardDefinition(deps, input),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.listBoardVersions]: (input: WorkflowGetBoardDefinitionInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.listBoardVersions, listBoardVersions(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.getBoardVersion]: (input: WorkflowGetBoardVersionInput) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.getBoardVersion, getBoardVersion(deps, input), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.subscribeBoard]: (input: { readonly boardId: BoardId }) =>
    deps.observeRpcStreamEffect(
      WORKFLOW_WS_METHODS.subscribeBoard,
      boardSnapshot(deps, input.boardId).pipe(
        Effect.map((snapshot) =>
          Stream.concat(
            Stream.make({ kind: "snapshot" as const, snapshot }),
            deps.boardEvents
              .stream(input.boardId)
              .pipe(Stream.map((ticket) => ({ kind: "ticket" as const, ticket }))),
          ),
        ),
      ),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.createTicket]: (input: WorkflowCreateTicketInput) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.createTicket,
      deps.engine
        .createTicket({
          boardId: input.boardId,
          title: input.title,
          initialLane: input.initialLane,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.dependsOn === undefined ? {} : { dependsOn: input.dependsOn }),
          ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
        })
        .pipe(
          Effect.mapError(toWorkflowRpcError("Failed to create workflow ticket")),
          Effect.map((ticketId) => ({ ticketId })),
        ),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.editTicket]: (input: WorkflowEditTicketInput) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.editTicket,
      deps.engine
        .editTicket(input)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to edit workflow ticket"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.moveTicket]: (input: {
    readonly ticketId: TicketId;
    readonly toLane: LaneKey;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.moveTicket,
      deps.engine
        .moveTicket(input.ticketId, input.toLane)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to move workflow ticket"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.runLane]: (input: { readonly ticketId: TicketId }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.runLane,
      deps.engine
        .runLane(input.ticketId)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to run workflow lane"))),
      {
        "rpc.aggregate": "workflow",
      },
    ),
  [WORKFLOW_WS_METHODS.resolveApproval]: (input: {
    readonly stepRunId: StepRunId;
    readonly approved: boolean;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.resolveApproval,
      deps.engine
        .resolveApproval(input.stepRunId, input.approved)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to resolve workflow approval"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.answerTicketStep]: (input: WorkflowAnswerTicketStepInput) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.answerTicketStep,
      deps.engine
        .answerTicketStep(input)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to answer workflow ticket step"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.postTicketMessage]: (input: {
    readonly ticketId: TicketId;
    readonly text?: string | undefined;
    readonly attachments?: ReadonlyArray<TicketAttachment> | undefined;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.postTicketMessage,
      deps.engine
        .postTicketMessage(input)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to post workflow ticket message"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.setProjectScriptTrust]: (input: {
    readonly projectId: ProjectId;
    readonly trusted: boolean;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.setProjectScriptTrust,
      deps.projectScriptTrust
        .setTrusted(input.projectId, input.trusted)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to update project script trust"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.cancelStep]: (input: { readonly stepRunId: StepRunId }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.cancelStep,
      deps.engine
        .cancelStep(input.stepRunId)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to cancel workflow step"))),
      { "rpc.aggregate": "workflow" },
    ),
  [WORKFLOW_WS_METHODS.getTicketDetail]: (input: { readonly ticketId: TicketId }) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.getTicketDetail, ticketDetail(deps, input.ticketId), {
      "rpc.aggregate": "workflow",
    }),
  [WORKFLOW_WS_METHODS.getTicketDiff]: (input: { readonly ticketId: TicketId }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.getTicketDiff,
      deps.ticketWorktrees
        .resolveForTicket(input.ticketId)
        .pipe(
          Effect.flatMap(({ cwd, baseRef }) =>
            deps.ticketDiff
              .getTicketDiff(input.ticketId, cwd, baseRef)
              .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow ticket diff"))),
          ),
        ),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.listTicketArtifacts]: (input: { readonly ticketId: TicketId }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.listTicketArtifacts,
      Effect.gen(function* () {
        const worktree = yield* deps.ticketWorktrees.resolveForTicket(input.ticketId);
        const scratchDir = `.t3/ticket/${input.ticketId}`;
        const names = yield* deps.workspaceFileSystem
          .listFiles({ cwd: worktree.cwd, relativePath: scratchDir })
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to list ticket artifacts")));
        const artifacts: Array<{
          readonly name: string;
          readonly content: string;
          readonly truncated?: boolean;
        }> = [];
        for (const name of names.slice(0, MAX_TICKET_ARTIFACTS)) {
          const content = yield* deps.workspaceFileSystem
            .readFileString({ cwd: worktree.cwd, relativePath: `${scratchDir}/${name}` })
            .pipe(Effect.mapError(toWorkflowRpcError("Failed to read ticket artifact")));
          artifacts.push({
            name,
            content: content.slice(0, MAX_TICKET_ARTIFACT_CHARS),
            ...(content.length > MAX_TICKET_ARTIFACT_CHARS ? { truncated: true } : {}),
          });
        }
        return { artifacts };
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.getBoardDigest]: (input: {
    readonly boardId: BoardId;
    readonly windowHours?: number | undefined;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.getBoardDigest,
      Effect.gen(function* () {
        const windowHours =
          input.windowHours === undefined || !Number.isFinite(input.windowHours)
            ? 24
            : Math.min(24 * 7, Math.max(1, Math.floor(input.windowHours)));
        const digest = yield* deps.readModel
          .getBoardDigest(input.boardId, windowHours)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to compute board digest")));
        return {
          windowHours: digest.windowHours,
          createdCount: digest.createdCount,
          shippedCount: digest.shippedCount,
          totalTokens: digest.totalTokens,
          totalDurationMs: digest.totalDurationMs,
          needsAttention: digest.needsAttention.map((row) => ({
            ticketId: row.ticketId as TicketId,
            title: row.title,
            status: row.status,
            laneKey: row.laneKey as LaneKey,
            sinceMs: Math.max(0, Math.floor(row.sinceMs)),
          })),
        };
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.getBoardMetrics]: (input: {
    readonly boardId: BoardId;
    readonly windowDays?: number | undefined;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.getBoardMetrics,
      Effect.gen(function* () {
        const VALID_WINDOW_DAYS = [1, 7, 30] as const;
        const windowDays =
          input.windowDays !== undefined &&
          VALID_WINDOW_DAYS.includes(input.windowDays as (typeof VALID_WINDOW_DAYS)[number])
            ? input.windowDays
            : 7;
        const metrics = yield* deps.readModel
          .getBoardMetrics(input.boardId, windowDays)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to compute board metrics")));
        return metrics;
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.dryRunBoard]: (input: {
    readonly definition: WorkflowDefinitionEncoded;
    readonly startLane: LaneKey;
    readonly scenario: WorkflowDryRunScenario;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.dryRunBoard,
      Effect.gen(function* () {
        const predicates = deps.predicates;
        if (predicates === undefined) {
          return yield* workflowRpcError("Dry run is not available on this server");
        }
        // Read-scoped callers send arbitrary definitions — bound the work
        // before decoding so a huge payload cannot burn CPU/memory.
        // The JSON.stringify call is wrapped in a try/catch because a pathologically
        // deep object can throw a RangeError before the length comparison — treat
        // that as "too large" so we always return a clean error response.
        let definitionJsonLength: number;
        // @effect-diagnostics-next-line tryCatchInEffectGen:off — synchronous size probe; not an Effect failure
        try {
          // @effect-diagnostics-next-line preferSchemaOverJson:off — pure size probe, not parsing
          definitionJsonLength = JSON.stringify(input.definition).length;
        } catch {
          return yield* workflowRpcError("Workflow definition is too large to dry-run");
        }
        if (
          definitionJsonLength > MAX_DRY_RUN_DEFINITION_CHARS ||
          input.definition.lanes.length > MAX_DRY_RUN_LANES ||
          input.definition.lanes.some(
            (lane) =>
              (lane.pipeline?.length ?? 0) > MAX_DRY_RUN_PER_LANE ||
              (lane.transitions?.length ?? 0) > MAX_DRY_RUN_PER_LANE ||
              (lane.onEvent?.length ?? 0) > MAX_DRY_RUN_PER_LANE,
          )
        ) {
          return yield* workflowRpcError("Workflow definition is too large to dry-run");
        }
        const definition = yield* Schema.decodeUnknownEffect(WorkflowDefinition)(
          input.definition,
        ).pipe(Effect.mapError(toWorkflowRpcError("Workflow definition is invalid")));
        if (
          !definition.lanes.some((lane) => (lane.key as string) === (input.startLane as string))
        ) {
          return yield* workflowRpcError(`Start lane "${input.startLane}" was not found`);
        }
        return yield* simulateBoardRoute({
          definition,
          startLane: input.startLane,
          scenario: input.scenario,
          evaluator: predicates,
        });
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.getWebhookConfig]: (input: {
    readonly boardId: BoardId;
    readonly rotate?: boolean | undefined;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.getWebhookConfig,
      Effect.gen(function* () {
        const webhook = deps.webhook;
        if (webhook === undefined) {
          return yield* workflowRpcError("Webhooks are not available on this server");
        }
        const board = yield* deps.readModel
          .getBoard(input.boardId)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to load workflow board")));
        if (board === null) {
          return yield* workflowRpcError(`Workflow board ${input.boardId} was not found`);
        }
        const config = yield* webhook
          .getConfig(input.boardId, input.rotate === true)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to load webhook config")));
        return {
          path: config.path,
          hasToken: config.hasToken,
          ...(config.tokenPrefix === undefined ? {} : { tokenPrefix: config.tokenPrefix }),
          ...(config.token === undefined ? {} : { token: config.token }),
        };
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.listNeedsAttentionTickets]: (_input: Record<string, never>) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.listNeedsAttentionTickets,
      Effect.gen(function* () {
        const rows = yield* deps.readModel
          .listNeedsAttentionTickets()
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to list needs-attention tickets")));
        return rows.map(
          (row): WorkflowNeedsAttentionTicketView => ({
            ticketId: row.ticketId as never,
            boardId: row.boardId as never,
            boardName: row.boardName,
            title: row.title,
            status: row.status as never,
            currentLaneKey: row.currentLaneKey as never,
            attentionKind: row.attentionKind as never,
            attentionReason: row.attentionReason,
            updatedAt: row.updatedAt,
          }),
        );
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.intakeTickets]: (input: {
    readonly boardId: BoardId;
    readonly braindump: string;
    readonly agent: AgentSelection;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.intakeTickets,
      Effect.gen(function* () {
        const intake = deps.intake;
        if (intake === undefined) {
          return yield* workflowRpcError("Ticket intake is not available on this server");
        }
        const proposals = yield* intake
          .proposeTickets(input)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to propose tickets from braindump")));
        return { proposals: [...proposals] } satisfies WorkflowIntakeResult;
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.listWorkSourceConnections]: (_input: Record<string, never>) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.listWorkSourceConnections,
      deps.connectionStore
        .list()
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to list work-source connections"))),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.createWorkSourceConnection]: (input: {
    readonly provider: WorkSourceProviderName;
    readonly displayName: string;
    readonly token: string;
  }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.createWorkSourceConnection,
      Effect.gen(function* () {
        const view = yield* deps.connectionStore
          .create(input)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to create work-source connection")));
        return view satisfies WorkSourceConnectionView;
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.deleteWorkSourceConnection]: (input: { readonly connectionRef: string }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.deleteWorkSourceConnection,
      deps.connectionStore
        .remove(input.connectionRef)
        .pipe(Effect.mapError(toWorkflowRpcError("Failed to delete work-source connection"))),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.listOutboundConnections]: (_input: Record<string, never>) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.listOutboundConnections,
      Effect.gen(function* () {
        const store = deps.outboundConnectionStore;
        if (store === undefined) {
          return yield* workflowRpcError("Outbound connections are not available on this server");
        }
        const connections = yield* store
          .list()
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to list outbound connections")));
        return { connections: [...connections] satisfies ReadonlyArray<OutboundConnectionView> };
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.createOutboundConnection]: (input: CreateOutboundConnectionInput) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.createOutboundConnection,
      Effect.gen(function* () {
        const store = deps.outboundConnectionStore;
        if (store === undefined) {
          return yield* workflowRpcError("Outbound connections are not available on this server");
        }
        const connection = yield* store
          .create(input)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to create outbound connection")));
        return { connection } satisfies { connection: OutboundConnectionView };
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.deleteOutboundConnection]: (input: { readonly connectionRef: string }) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.deleteOutboundConnection,
      Effect.gen(function* () {
        const store = deps.outboundConnectionStore;
        if (store === undefined) {
          return yield* workflowRpcError("Outbound connections are not available on this server");
        }
        yield* store
          .remove(input.connectionRef)
          .pipe(Effect.mapError(toWorkflowRpcError("Failed to delete outbound connection")));
      }),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.proposeBoardImprovement]: (
    input: WorkflowProposeBoardImprovementInputType,
  ) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.proposeBoardImprovement,
      proposeBoardImprovement(deps, input),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.listBoardProposals]: (input: WorkflowListBoardProposalsInputType) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.listBoardProposals, listBoardProposals(deps, input), {
      "rpc.aggregate": "workflow",
    }),

  [WORKFLOW_WS_METHODS.getBoardProposal]: (input: WorkflowGetBoardProposalInputType) =>
    deps.observeRpcEffect(WORKFLOW_WS_METHODS.getBoardProposal, getBoardProposal(deps, input), {
      "rpc.aggregate": "workflow",
    }),

  [WORKFLOW_WS_METHODS.resolveBoardProposal]: (input: WorkflowResolveBoardProposalInputType) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.resolveBoardProposal,
      resolveBoardProposal(deps, input),
      { "rpc.aggregate": "workflow" },
    ),

  [WORKFLOW_WS_METHODS.revertBoardProposal]: (input: WorkflowRevertBoardProposalInputType) =>
    deps.observeRpcEffect(
      WORKFLOW_WS_METHODS.revertBoardProposal,
      revertBoardProposal(deps, input),
      { "rpc.aggregate": "workflow" },
    ),
});
