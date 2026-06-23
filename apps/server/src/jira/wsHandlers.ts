// EMPOWERRD: fork-owned WS RPC handlers for Jira.
//
// Supplied as a SEPARATE handler layer (ForkWsRpcGroup.toLayer) that is merged
// into the /ws route's provide chain in ws.ts, so the upstream WsRpcGroup.of({…})
// handler object is never edited.
//
// Design (Problem A): the Jira key lives in a fork-owned side-table written
// directly here. The branch rename reuses the EXISTING `thread.meta.update`
// command (no decider/projector/core-schema edits). The handler returns the
// persisted key + resulting branch so the client store can update synchronously.
//
// The pure logic lives in `makeForkJiraHandlers` so it can be unit-tested with
// plain mocks; the layer just resolves services and forwards them.
import {
  type CommandId,
  CommandId as CommandIdSchema,
  ForkWsRpcGroup,
  JIRA_WS_METHODS,
  JiraOperationError,
  type ProjectId,
  type SetThreadJiraKeyInput,
  type ThreadId,
  type ThreadJiraKey,
  type ThreadJiraKeyList,
} from "@t3tools/contracts";
import {
  buildRenamedJiraBranchName,
  isMainOrMasterBranchName,
  validateJiraKeyInput,
} from "@t3tools/shared/jira";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService, type GitWorkflowServiceShape } from "../git/GitWorkflowService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ProjectionThreadJiraRepository,
  type ProjectionThreadJiraRepositoryShape,
} from "../persistence/Services/ProjectionThreadJira.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const failWith = (message: string, cause?: unknown) =>
  new JiraOperationError({ message, ...(cause === undefined ? {} : { cause }) });

export interface ForkJiraHandlerDeps {
  readonly projectKey: string | null;
  readonly newCommandId: (tag: string) => Effect.Effect<CommandId, JiraOperationError>;
  readonly gitWorkflow: Pick<
    GitWorkflowServiceShape,
    "renameBranch" | "localStatus" | "invalidateStatus"
  >;
  readonly orchestrationEngine: Pick<OrchestrationEngineShape, "dispatch">;
  readonly projectionSnapshotQuery: Pick<
    ProjectionSnapshotQueryShape,
    "getThreadShellById" | "getProjectShellById"
  >;
  readonly jiraRepository: ProjectionThreadJiraRepositoryShape;
}

export interface ForkJiraHandlers {
  readonly setThreadJiraKey: (
    input: SetThreadJiraKeyInput,
  ) => Effect.Effect<ThreadJiraKey, JiraOperationError>;
  readonly listThreadJiraKeys: () => Effect.Effect<ThreadJiraKeyList, JiraOperationError>;
}

export const makeForkJiraHandlers = (deps: ForkJiraHandlerDeps): ForkJiraHandlers => {
  const { projectKey, newCommandId, gitWorkflow, orchestrationEngine, jiraRepository } = deps;
  const { getThreadShellById, getProjectShellById } = deps.projectionSnapshotQuery;

  const loadThreadShell = (threadId: ThreadId) =>
    getThreadShellById(threadId).pipe(
      Effect.mapError((cause) => failWith("Failed to load thread.", cause)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failWith("Thread not found.")),
          onSome: (thread) => Effect.succeed(thread),
        }),
      ),
    );

  const loadProjectWorkspaceRoot = (projectId: ProjectId) =>
    getProjectShellById(projectId).pipe(
      Effect.mapError((cause) => failWith("Failed to load project.", cause)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failWith("Project not found.")),
          onSome: (project) => Effect.succeed(project.workspaceRoot),
        }),
      ),
    );

  // Enforce: a Jira key may only be set for worktree threads, or when the
  // project's current checkout is not main/master.
  const ensureAllowedForContext = (thread: {
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }) =>
    Effect.gen(function* () {
      if (thread.worktreePath !== null) {
        return;
      }
      const workspaceRoot = yield* loadProjectWorkspaceRoot(thread.projectId);
      const local = yield* gitWorkflow
        .localStatus({ cwd: workspaceRoot })
        .pipe(Effect.mapError((cause) => failWith("Failed to read git status.", cause)));
      const effectiveBranch = local.refName ?? thread.branch;
      if (effectiveBranch !== null && !isMainOrMasterBranchName(effectiveBranch)) {
        return;
      }
      return yield* failWith(
        "Jira keys can only be set for worktree threads or when the current checkout is not main or master.",
      );
    });

  const setThreadJiraKey: ForkJiraHandlers["setThreadJiraKey"] = (input) =>
    Effect.gen(function* () {
      const thread = yield* loadThreadShell(input.threadId);

      // Clearing the key: just remove the row.
      if (input.jiraKey === null) {
        yield* jiraRepository
          .deleteByThreadId({ threadId: input.threadId })
          .pipe(Effect.mapError((cause) => failWith("Failed to clear Jira key.", cause)));
        return { threadId: input.threadId, jiraKey: null, branch: thread.branch };
      }

      // Setting a key: validate (incl. project-key constraint) + context rule.
      const validation = validateJiraKeyInput(input.jiraKey, projectKey);
      if (validation.normalized === null) {
        return yield* failWith(validation.error ?? "Invalid Jira key.");
      }
      const normalizedJiraKey = validation.normalized;
      yield* ensureAllowedForContext(thread);

      // Optionally rename the worktree branch, reusing the existing
      // thread.meta.update command to persist the new branch.
      let resultBranch = thread.branch;
      if (input.renameBranch && thread.branch !== null) {
        const cwd = thread.worktreePath ?? (yield* loadProjectWorkspaceRoot(thread.projectId));
        const targetBranch = buildRenamedJiraBranchName({
          currentBranch: thread.branch,
          newJiraKey: normalizedJiraKey,
          fallbackTitle: thread.title,
        });
        if (targetBranch !== thread.branch) {
          const renamed = yield* gitWorkflow
            .renameBranch({ cwd, oldBranch: thread.branch, newBranch: targetBranch })
            .pipe(Effect.mapError((cause) => failWith("Failed to rename branch.", cause)));
          resultBranch = renamed.branch;
          yield* orchestrationEngine
            .dispatch({
              type: "thread.meta.update",
              commandId: yield* newCommandId("jira-key-branch-rename"),
              threadId: input.threadId,
              branch: renamed.branch,
            })
            .pipe(Effect.mapError((cause) => failWith("Failed to update thread branch.", cause)));
          yield* gitWorkflow.invalidateStatus(cwd);
        }
      }

      const updatedAt = yield* nowIso;
      yield* jiraRepository
        .upsert({ threadId: input.threadId, jiraKey: normalizedJiraKey, updatedAt })
        .pipe(Effect.mapError((cause) => failWith("Failed to save Jira key.", cause)));

      return { threadId: input.threadId, jiraKey: normalizedJiraKey, branch: resultBranch };
    });

  const listThreadJiraKeys: ForkJiraHandlers["listThreadJiraKeys"] = () =>
    jiraRepository.listAll().pipe(
      Effect.mapError((cause) => failWith("Failed to list Jira keys.", cause)),
      Effect.map((rows) => rows.map((row) => ({ threadId: row.threadId, jiraKey: row.jiraKey }))),
    );

  return { setThreadJiraKey, listThreadJiraKeys };
};

export const ForkJiraWsRpcLayer = ForkWsRpcGroup.toLayer(
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const config = yield* ServerConfig;
    const gitWorkflow = yield* GitWorkflowService;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const jiraRepository = yield* ProjectionThreadJiraRepository;

    const handlers = makeForkJiraHandlers({
      projectKey: config.jira?.projectKey ?? null,
      newCommandId: (tag) =>
        crypto.randomUUIDv4.pipe(
          Effect.mapError((cause) => failWith("Failed to generate command identifier.", cause)),
          Effect.map((uuid) => CommandIdSchema.make(`server:${tag}:${uuid}`)),
        ),
      gitWorkflow,
      orchestrationEngine,
      projectionSnapshotQuery,
      jiraRepository,
    });

    return ForkWsRpcGroup.of({
      [JIRA_WS_METHODS.setThreadJiraKey]: handlers.setThreadJiraKey,
      [JIRA_WS_METHODS.listThreadJiraKeys]: handlers.listThreadJiraKeys,
    });
  }),
);
