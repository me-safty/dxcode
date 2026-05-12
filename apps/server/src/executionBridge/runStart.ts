import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ExecutionRunCreateRequest,
  type ExecutionRunCreateResponse,
  type ExecutionRunContinueRequest,
  type ExecutionRunContinueResponse,
  type ExecutionRunInterruptRequest,
  type ExecutionRunInterruptResponse,
  type ExecutionRunLifecycleEvent,
  MessageId,
  ProjectId,
  type TaskPullRequestEnsureRequest,
  type TaskPullRequestEnsureResponse,
  type TaskRuntimeLifecycleEvent,
  type TaskRuntimeMaterializeRequest,
  type TaskRuntimeMaterializeResponse,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { GitManager } from "../git/GitManager.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { GitVcsDriver, type GitVcsDriverShape } from "../vcs/GitVcsDriver.ts";
import { resolveExecutionBridgeModelSelection } from "./requestDefaults.ts";

export type ExecutionLifecycleCheckpoint = "started" | "completed" | "failed" | "interrupted";

export interface TrackedExecutionRun {
  readonly kind: "execution" | "task";
  readonly controlThreadId: string;
  readonly executionRunId: string;
  readonly taskId: string | null;
  readonly workSessionId: string | null;
  readonly threadId: ThreadId;
  readonly startedEventId: string | null;
  readonly completedEventId: string | null;
  readonly failedEventId: string | null;
  readonly interruptedEventId: string | null;
  readonly lastTurnId: TurnId | null;
}

interface MaterializedTaskRuntimeRecord {
  readonly response: TaskRuntimeMaterializeResponse;
  readonly threadStarted: boolean;
}

interface ExecutionBridgeRunRegistryShape {
  readonly trackAcceptedRun: (
    input: Pick<TrackedExecutionRun, "controlThreadId" | "executionRunId" | "threadId">,
  ) => Effect.Effect<void, never, never>;
  readonly trackAcceptedTaskRuntime: (
    input: Pick<TrackedExecutionRun, "taskId" | "workSessionId" | "threadId">,
  ) => Effect.Effect<void, never, never>;
  readonly getTrackedRun: (
    threadId: ThreadId,
  ) => Effect.Effect<TrackedExecutionRun | null, never, never>;
  readonly markLifecycleDelivered: (
    input: Pick<TrackedExecutionRun, "threadId"> & {
      readonly type: ExecutionLifecycleCheckpoint;
      readonly eventId: string;
      readonly turnId?: TurnId;
    },
  ) => Effect.Effect<void, never, never>;
  readonly getMaterializedTaskRuntime: (
    idempotencyKey: string,
  ) => Effect.Effect<MaterializedTaskRuntimeRecord | null, never, never>;
  readonly trackMaterializedTaskRuntime: (
    idempotencyKey: string,
    record: MaterializedTaskRuntimeRecord,
  ) => Effect.Effect<void, never, never>;
}

export class ExecutionBridgeRunRegistry extends Context.Service<
  ExecutionBridgeRunRegistry,
  ExecutionBridgeRunRegistryShape
>()("t3/executionBridge/ExecutionBridgeRunRegistry") {}

function deriveProjectTitle(workspaceRoot: string) {
  const segments = workspaceRoot.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? "project";
}

function deriveThreadTitle(input: ExecutionRunCreateRequest) {
  const trimmedTitle = input.title?.trim();
  return trimmedTitle || `Run ${input.controlThreadId}`;
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized.length > 0 ? normalized : "task";
}

function taskBranchName(request: TaskRuntimeMaterializeRequest) {
  return `codex/${slug(request.title)}-${slug(request.workSessionId).slice(-16)}`;
}

const makeExecutionBridgeRunRegistry = Effect.gen(function* () {
  const state = yield* Ref.make(new Map<string, TrackedExecutionRun>());
  const materializedTaskRuntimes = yield* Ref.make(
    new Map<string, MaterializedTaskRuntimeRecord>(),
  );

  const trackAcceptedRun: ExecutionBridgeRunRegistryShape["trackAcceptedRun"] = (input) =>
    Ref.update(state, (current) => {
      const next = new Map(current);
      next.set(String(input.threadId), {
        controlThreadId: input.controlThreadId,
        executionRunId: input.executionRunId,
        kind: "execution",
        taskId: null,
        workSessionId: null,
        threadId: input.threadId,
        startedEventId: null,
        completedEventId: null,
        failedEventId: null,
        interruptedEventId: null,
        lastTurnId: null,
      });
      return next;
    });

  const trackAcceptedTaskRuntime: ExecutionBridgeRunRegistryShape["trackAcceptedTaskRuntime"] = (
    input,
  ) =>
    Ref.update(state, (current) => {
      const next = new Map(current);
      next.set(String(input.threadId), {
        controlThreadId: input.taskId ?? "",
        executionRunId: input.workSessionId ?? "",
        kind: "task",
        taskId: input.taskId,
        workSessionId: input.workSessionId,
        threadId: input.threadId,
        startedEventId: null,
        completedEventId: null,
        failedEventId: null,
        interruptedEventId: null,
        lastTurnId: null,
      });
      return next;
    });

  const getTrackedRun: ExecutionBridgeRunRegistryShape["getTrackedRun"] = (threadId) =>
    Ref.get(state).pipe(Effect.map((current) => current.get(String(threadId)) ?? null));

  const markLifecycleDelivered: ExecutionBridgeRunRegistryShape["markLifecycleDelivered"] = (
    input,
  ) =>
    Ref.update(state, (current) => {
      const tracked = current.get(String(input.threadId));
      if (!tracked) return current;

      const next = new Map(current);
      next.set(String(input.threadId), {
        ...tracked,
        startedEventId: input.type === "started" ? input.eventId : tracked.startedEventId,
        completedEventId: input.type === "completed" ? input.eventId : tracked.completedEventId,
        failedEventId: input.type === "failed" ? input.eventId : tracked.failedEventId,
        interruptedEventId:
          input.type === "interrupted" ? input.eventId : tracked.interruptedEventId,
        lastTurnId: input.turnId ?? tracked.lastTurnId,
      });
      return next;
    });

  return {
    trackAcceptedRun,
    trackAcceptedTaskRuntime,
    getTrackedRun,
    markLifecycleDelivered,
    getMaterializedTaskRuntime: (idempotencyKey) =>
      Ref.get(materializedTaskRuntimes).pipe(
        Effect.map((current) => current.get(idempotencyKey) ?? null),
      ),
    trackMaterializedTaskRuntime: (idempotencyKey, record) =>
      Ref.update(materializedTaskRuntimes, (current) => {
        const next = new Map(current);
        next.set(idempotencyKey, record);
        return next;
      }),
  } satisfies ExecutionBridgeRunRegistryShape;
});

export const ExecutionBridgeRunRegistryLive = Layer.effect(
  ExecutionBridgeRunRegistry,
  makeExecutionBridgeRunRegistry,
);

export class ExecutionBridgeRunStartError extends Schema.TaggedErrorClass<ExecutionBridgeRunStartError>()(
  "ExecutionBridgeRunStartError",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

const currentIsoTimestamp = Effect.map(DateTime.now, (now) =>
  DateTime.formatIso(DateTime.toUtc(now)),
);

export const startExecutionRun = (request: ExecutionRunCreateRequest) =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const runRegistry = yield* ExecutionBridgeRunRegistry;
    const now = yield* currentIsoTimestamp;

    const existingProject = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
      request.workspaceRoot,
    );

    const projectId = Option.isSome(existingProject)
      ? existingProject.value.id
      : ProjectId.make(crypto.randomUUID());
    const modelSelection = resolveExecutionBridgeModelSelection(
      request,
      Option.isSome(existingProject) ? existingProject.value.defaultModelSelection : null,
    );

    if (Option.isNone(existingProject)) {
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make(`execution-bridge:project:create:${request.executionRunId}`),
        projectId,
        title: deriveProjectTitle(request.workspaceRoot),
        workspaceRoot: request.workspaceRoot,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: modelSelection,
        createdAt: now,
      });
    }

    const threadId = ThreadId.make(crypto.randomUUID());
    yield* orchestrationEngine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`execution-bridge:thread:create:${request.executionRunId}`),
      threadId,
      projectId,
      title: deriveThreadTitle(request),
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
    });

    if (request.taskRuntime === true) {
      yield* runRegistry.trackAcceptedTaskRuntime({
        taskId: request.controlThreadId,
        workSessionId: request.executionRunId,
        threadId,
      });
    } else {
      yield* runRegistry.trackAcceptedRun({
        controlThreadId: request.controlThreadId,
        executionRunId: request.executionRunId,
        threadId,
      });
    }

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`execution-bridge:turn:start:${request.executionRunId}`),
      threadId,
      message: {
        messageId: MessageId.make(`execution-run:${request.executionRunId}`),
        role: "user",
        text: request.initialPrompt,
        attachments: [],
      },
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt: now,
    });

    return {
      controlThreadId: request.controlThreadId,
      executionRunId: request.executionRunId,
      t3ThreadId: threadId,
      acceptedAt: now,
    } satisfies ExecutionRunCreateResponse;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ExecutionBridgeRunStartError({
          message:
            cause instanceof Error ? cause.message : "Failed to dispatch execution bridge run.",
          status: 400,
        }),
    ),
  );

export const continueExecutionRun = (request: ExecutionRunContinueRequest) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const runRegistry = yield* ExecutionBridgeRunRegistry;
    const now = yield* currentIsoTimestamp;
    const messageNonce = crypto.randomUUID();

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(
        `execution-bridge:turn:continue:${request.executionRunId}:${messageNonce}`,
      ),
      threadId: request.t3ThreadId,
      message: {
        messageId: MessageId.make(
          `execution-run:continue:${request.executionRunId}:${messageNonce}`,
        ),
        role: "user",
        text: request.prompt,
        attachments: [],
      },
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt: now,
    });

    const existingTracked = yield* runRegistry.getTrackedRun(request.t3ThreadId);
    if (existingTracked === null || existingTracked.executionRunId !== request.executionRunId) {
      yield* runRegistry.trackAcceptedRun({
        controlThreadId: request.controlThreadId,
        executionRunId: request.executionRunId,
        threadId: request.t3ThreadId,
      });
    }

    return {
      executionRunId: request.executionRunId,
      t3ThreadId: request.t3ThreadId,
      acceptedAt: now,
    } satisfies ExecutionRunContinueResponse;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ExecutionBridgeRunStartError({
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to dispatch execution bridge continue.",
          status: 400,
        }),
    ),
  );

export const interruptExecutionRun = (request: ExecutionRunInterruptRequest) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const now = yield* currentIsoTimestamp;
    const commandNonce = crypto.randomUUID();

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.interrupt",
      commandId: CommandId.make(
        `execution-bridge:turn:interrupt:${request.executionRunId}:${commandNonce}`,
      ),
      threadId: request.t3ThreadId,
      createdAt: now,
    });

    return {
      executionRunId: request.executionRunId,
      t3ThreadId: request.t3ThreadId,
      acceptedAt: now,
    } satisfies ExecutionRunInterruptResponse;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ExecutionBridgeRunStartError({
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to dispatch execution bridge interrupt.",
          status: 400,
        }),
    ),
  );

export const materializeTaskRuntime = (request: TaskRuntimeMaterializeRequest) =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const runRegistry = yield* ExecutionBridgeRunRegistry;
    const git = yield* GitVcsDriver;
    const serverEnvironment = yield* ServerEnvironment;
    const now = yield* currentIsoTimestamp;
    const idempotencyKey =
      request.idempotencyKey ?? `task-runtime:${request.taskId}:${request.workSessionId}`;
    const existing = yield* runRegistry.getMaterializedTaskRuntime(idempotencyKey);
    if (existing) {
      if (request.startCodingAgent && !existing.threadStarted) {
        yield* runRegistry.trackAcceptedTaskRuntime({
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          threadId: existing.response.t3ThreadId,
        });
        yield* runRegistry.trackMaterializedTaskRuntime(idempotencyKey, {
          ...existing,
          threadStarted: true,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`execution-bridge:task:turn:start:${request.workSessionId}`),
          threadId: existing.response.t3ThreadId,
          message: {
            messageId: MessageId.make(`task-runtime:${request.workSessionId}`),
            role: "user",
            text: request.initialPrompt,
            attachments: [],
          },
          modelSelection: request.modelSelection,
          runtimeMode: request.runtimeMode,
          interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: now,
        });
      }
      return existing.response;
    }

    const existingProject = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(
      request.project.workspaceRoot,
    );
    const projectId = Option.isSome(existingProject)
      ? existingProject.value.id
      : ProjectId.make(crypto.randomUUID());
    const modelSelection = resolveExecutionBridgeModelSelection(
      request,
      Option.isSome(existingProject) ? existingProject.value.defaultModelSelection : null,
    );

    if (Option.isNone(existingProject)) {
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make(`execution-bridge:task:project:create:${request.workSessionId}`),
        projectId,
        title: request.project.repoName,
        workspaceRoot: request.project.workspaceRoot,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: modelSelection,
        createdAt: now,
      });
    }

    const branch = taskBranchName(request);
    const worktree = yield* git.createWorktree({
      cwd: request.project.workspaceRoot,
      refName: request.project.defaultBranch,
      newRefName: branch,
      path: null,
    });
    const threadId = ThreadId.make(crypto.randomUUID());

    yield* orchestrationEngine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`execution-bridge:task:thread:create:${request.workSessionId}`),
      threadId,
      projectId,
      title: request.title,
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: worktree.worktree.refName,
      worktreePath: worktree.worktree.path,
      createdAt: now,
    });

    if (request.startCodingAgent) {
      yield* runRegistry.trackAcceptedTaskRuntime({
        taskId: request.taskId,
        workSessionId: request.workSessionId,
        threadId,
      });

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`execution-bridge:task:turn:start:${request.workSessionId}`),
        threadId,
        message: {
          messageId: MessageId.make(`task-runtime:${request.workSessionId}`),
          role: "user",
          text: request.initialPrompt,
          attachments: [],
        },
        modelSelection,
        runtimeMode: request.runtimeMode,
        interactionMode: request.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      });
    }

    const response = {
      taskId: request.taskId,
      workSessionId: request.workSessionId,
      t3ProjectId: projectId,
      t3ThreadId: threadId,
      branch: worktree.worktree.refName,
      worktreePath: worktree.worktree.path,
      acceptedAt: now,
      environment: yield* serverEnvironment.getDescriptor,
    } satisfies TaskRuntimeMaterializeResponse;
    yield* runRegistry.trackMaterializedTaskRuntime(idempotencyKey, {
      response,
      threadStarted: request.startCodingAgent,
    });

    return response;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ExecutionBridgeRunStartError({
          message:
            cause instanceof Error ? cause.message : "Failed to materialize Task runtime in T3.",
          status: 400,
        }),
    ),
  );

function parseGitHubPullRequestUrl(
  url: string | undefined,
): { owner: string; repo: string; number: number; url: string } | null {
  const match = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:\/[^\s]*)?/i.exec(
    url ?? "",
  );
  if (!match) return null;
  const [matchedUrl, owner, repo, numberText] = match;
  const number = Number(numberText);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) return null;
  return { owner, repo, number, url: matchedUrl };
}

const readAheadCount = Effect.fn("executionBridge.readAheadCount")(function* (
  git: GitVcsDriverShape,
  cwd: string,
  baseRef: string,
) {
  const result = yield* git.execute({
    operation: "ExecutionBridge.ensureTaskPullRequest.readAheadCount",
    cwd,
    args: ["rev-list", "--count", `${baseRef}..HEAD`],
  });
  const count = Number(result.stdout.trim());
  return Number.isFinite(count) && count > 0 ? count : 0;
});

const hasCommittedChangesAgainstBase = Effect.fn("executionBridge.hasCommittedChangesAgainstBase")(
  function* (git: GitVcsDriverShape, cwd: string, baseBranch: string) {
    const localCount = yield* readAheadCount(git, cwd, baseBranch).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (localCount !== null) return localCount > 0;

    const remoteCount = yield* readAheadCount(git, cwd, `origin/${baseBranch}`).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    return remoteCount !== null && remoteCount > 0;
  },
);

const configureTaskPullRequestBaseBranch = Effect.fn(
  "executionBridge.configureTaskPullRequestBaseBranch",
)(function* (git: GitVcsDriverShape, cwd: string, branch: string, baseBranch: string) {
  yield* git
    .execute({
      operation: "ExecutionBridge.ensureTaskPullRequest.configureBaseBranch",
      cwd,
      args: ["config", `branch.${branch}.gh-merge-base`, baseBranch],
    })
    .pipe(Effect.catch(() => Effect.void));
});

const recoverTaskPullRequestBranch = Effect.fn("executionBridge.recoverTaskPullRequestBranch")(
  function* (git: GitVcsDriverShape, cwd: string, expectedBranch: string) {
    yield* git.execute({
      operation: "ExecutionBridge.ensureTaskPullRequest.recoverBranch",
      cwd,
      args: ["checkout", "-B", expectedBranch],
    });
    return yield* git.statusDetails(cwd);
  },
);

export const ensureTaskPullRequest = (request: TaskPullRequestEnsureRequest) =>
  Effect.gen(function* () {
    const git = yield* GitVcsDriver;
    const gitManager = yield* GitManager;
    const checkedAt = yield* currentIsoTimestamp;
    let details = yield* git.statusDetails(request.worktreePath);
    let branch = details.branch ?? request.branch;

    if (branch !== request.branch) {
      details = yield* recoverTaskPullRequestBranch(git, request.worktreePath, request.branch);
      branch = details.branch ?? request.branch;

      if (branch !== request.branch) {
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          status: "failed",
          checkedAt,
          summary: `Worktree is on branch ${branch}, expected ${request.branch}.`,
        } satisfies TaskPullRequestEnsureResponse;
      }
    }

    if (!details.hasWorkingTreeChanges && !details.hasUpstream && details.aheadCount === 0) {
      return {
        taskId: request.taskId,
        workSessionId: request.workSessionId,
        status: "waiting_for_changes",
        checkedAt,
        summary: "No task changes have been committed or staged yet.",
      } satisfies TaskPullRequestEnsureResponse;
    }

    const baseBranch = request.project.defaultBranch;
    yield* configureTaskPullRequestBaseBranch(git, request.worktreePath, branch, baseBranch);

    if (!details.hasWorkingTreeChanges) {
      const hasCommittedChanges = yield* hasCommittedChangesAgainstBase(
        git,
        request.worktreePath,
        baseBranch,
      );
      if (!hasCommittedChanges) {
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          status: "waiting_for_changes",
          checkedAt,
          summary: "No task changes have been committed or staged yet.",
        } satisfies TaskPullRequestEnsureResponse;
      }
    }

    const action = details.hasWorkingTreeChanges ? "commit_push_pr" : "create_pr";
    const result = yield* gitManager.runStackedAction(
      {
        actionId: request.idempotencyKey,
        cwd: request.worktreePath,
        action,
        commitMessage: request.title,
        sourceControlRepository: `${request.project.githubOwner}/${request.project.githubRepo}`,
      },
      { draftPullRequest: true },
    );

    if (result.pr.status !== "created" && result.pr.status !== "opened_existing") {
      return {
        taskId: request.taskId,
        workSessionId: request.workSessionId,
        status: "waiting_for_changes",
        checkedAt,
        summary: "No pull request was created because there are no publishable changes yet.",
      } satisfies TaskPullRequestEnsureResponse;
    }

    const parsed = parseGitHubPullRequestUrl(result.pr.url);
    const pullRequestNumber = result.pr.number ?? parsed?.number;
    if (!parsed || pullRequestNumber === undefined) {
      return {
        taskId: request.taskId,
        workSessionId: request.workSessionId,
        status: "failed",
        checkedAt,
        summary: "GitHub pull request was created, but T3 could not parse its URL.",
      } satisfies TaskPullRequestEnsureResponse;
    }

    return {
      taskId: request.taskId,
      workSessionId: request.workSessionId,
      status: result.pr.status === "opened_existing" ? "existing" : "created",
      checkedAt,
      pullRequest: {
        owner: parsed.owner,
        repo: parsed.repo,
        number: pullRequestNumber,
        url: parsed.url,
        headBranch: result.pr.headBranch ?? request.branch,
        baseBranch: result.pr.baseBranch ?? request.project.defaultBranch,
        title: result.pr.title ?? request.title,
        draft: result.pr.status === "created",
      },
    } satisfies TaskPullRequestEnsureResponse;
  }).pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        const checkedAt = yield* currentIsoTimestamp;
        return {
          taskId: request.taskId,
          workSessionId: request.workSessionId,
          status: "failed",
          checkedAt,
          summary:
            cause instanceof Error ? cause.message : "Failed to ensure a GitHub pull request.",
        } satisfies TaskPullRequestEnsureResponse;
      }),
    ),
  );

export function buildLifecycleEvent(input: {
  readonly trackedRun: TrackedExecutionRun;
  readonly type: ExecutionLifecycleCheckpoint;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly t3TurnId?: TurnId;
  readonly failureSummary?: string;
}): ExecutionRunLifecycleEvent {
  return {
    eventId: input.eventId,
    controlThreadId: input.trackedRun.controlThreadId,
    executionRunId: input.trackedRun.executionRunId,
    type: input.type,
    occurredAt: input.occurredAt,
    t3ThreadId: input.trackedRun.threadId,
    ...((input.t3TurnId ?? input.trackedRun.lastTurnId)
      ? { t3TurnId: input.t3TurnId ?? input.trackedRun.lastTurnId! }
      : {}),
    ...(input.failureSummary ? { failureSummary: input.failureSummary } : {}),
  };
}

export function buildTaskRuntimeLifecycleEvent(input: {
  readonly trackedRun: TrackedExecutionRun;
  readonly type: ExecutionLifecycleCheckpoint;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly t3TurnId?: TurnId;
  readonly failureSummary?: string;
}): TaskRuntimeLifecycleEvent {
  if (input.trackedRun.taskId === null || input.trackedRun.workSessionId === null) {
    throw new Error("Cannot build Task runtime lifecycle event for non-Task tracked run.");
  }

  return {
    eventId: input.eventId,
    taskId: input.trackedRun.taskId,
    workSessionId: input.trackedRun.workSessionId,
    type: input.type,
    occurredAt: input.occurredAt,
    t3ThreadId: input.trackedRun.threadId,
    ...((input.t3TurnId ?? input.trackedRun.lastTurnId)
      ? { t3TurnId: input.t3TurnId ?? input.trackedRun.lastTurnId! }
      : {}),
    ...(input.failureSummary ? { failureSummary: input.failureSummary } : {}),
  };
}
