import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ProjectId,
  STANDALONE_CHAT_PROJECT_ID,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ScheduledTasks from "../../../scheduledTasks.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnBootstrapDispatcher from "../../../orchestration/ThreadTurnBootstrapDispatcher.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  MognetMcpError,
  type MognetPresentationPolicy,
  type MognetScope,
  type MognetThreadSummary,
  MognetToolkit,
  type MognetDelegateTaskInput,
  type MognetProjectContextResult,
  type MognetThreadCommandResult,
  type MognetThreadHandoffInput,
  type MognetThreadStartInput,
  type MognetThreadStatusResult,
  type MognetThreadsListInput,
  type MognetThreadsListResult,
} from "./tools.ts";

type ThreadTurnStartCommand = Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const toMognetError = (operation: string) => (cause: unknown) =>
  new MognetMcpError({
    operation,
    message: cause instanceof Error ? cause.message : "Mognet MCP operation failed.",
    cause,
  });

const requireOrchestration = (operation: string) =>
  McpInvocationContext.requireMognetCapability("orchestration").pipe(
    Effect.mapError(toMognetError(operation)),
  );

const requireScheduledTasks = (operation: string) =>
  McpInvocationContext.requireMognetCapability("scheduled-tasks").pipe(
    Effect.mapError(toMognetError(operation)),
  );

const routeFor = (input: { readonly environmentId: string; readonly threadId: ThreadId }) => ({
  environmentId: input.environmentId,
  threadId: input.threadId,
  routePath: `/${input.environmentId}/${input.threadId}`,
});

const compactText = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;

const deriveTitle = (prompt: string, fallback: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return compactText(normalized || fallback, 80);
};

const latestMessages = (thread: OrchestrationThread, count: number) =>
  thread.messages.slice(-count).map((message) => ({
    role: message.role,
    createdAt: message.createdAt,
    text: compactText(message.text, 2_000),
  }));

const scopeFor = (
  project: OrchestrationProjectShell,
  thread?: Pick<OrchestrationThread | OrchestrationThreadShell, "branch"> | null,
): MognetScope => {
  if (project.kind === "standalone") {
    return {
      kind: "standalone-chat",
      containerId: null,
      title: project.title,
      workspaceRoot: null,
      branch: null,
      repositoryApplicable: false,
      scriptsApplicable: false,
      presentation:
        "Standalone chat scope. Present as a chat, not a project. Do not mention internal project IDs, chat workspace paths, null branch values, routes, or exact thread counts unless the user explicitly asks for raw/internal diagnostics.",
    };
  }

  return {
    kind: "workspace-project",
    containerId: project.id,
    title: project.title,
    workspaceRoot: project.workspaceRoot,
    branch: thread?.branch ?? null,
    repositoryApplicable: true,
    scriptsApplicable: true,
    presentation:
      "Workspace project scope. Present as a project; workspace root, branch, repository, and project scripts may apply.",
  };
};

const standaloneChatScope = (): MognetScope => ({
  kind: "standalone-chat",
  containerId: null,
  title: "Chat",
  workspaceRoot: null,
  branch: null,
  repositoryApplicable: false,
  scriptsApplicable: false,
  presentation:
    "Standalone chat scope. Present as a chat, not a project. Do not mention internal project IDs, chat workspace paths, null branch values, routes, or exact thread counts unless the user explicitly asks for raw/internal diagnostics.",
});

const presentationForScope = (scope: MognetScope | null): MognetPresentationPolicy | null => {
  if (scope === null) {
    return null;
  }
  if (scope.kind === "standalone-chat") {
    return {
      scopeKind: "standalone-chat",
      publicLabel: scope.title,
      exposeInternalContainerId: false,
      exposeWorkspacePath: false,
      exposeBranch: false,
      exposeThreadCounts: false,
      exposeRoute: false,
      responseGuidance:
        "For standalone Chat, answer with the chat label and thread facts only. Do not print the internal projectId, chat workspace path, branch/null values, thread route, or exact active-thread counts unless the user explicitly asks for raw/internal diagnostics. If a generic context prompt asks for workspace path or branch, say no workspace project or Git branch is attached.",
    };
  }
  return {
    scopeKind: "workspace-project",
    publicLabel: scope.title,
    exposeInternalContainerId: true,
    exposeWorkspacePath: true,
    exposeBranch: true,
    exposeThreadCounts: true,
    exposeRoute: true,
    responseGuidance:
      "For workspace projects, project ID, workspace path, branch, route, and thread counts may be reported when relevant to the user's request.",
  };
};

const threadSummary = (
  thread: Pick<
    OrchestrationThread | OrchestrationThreadShell,
    "id" | "title" | "modelSelection" | "runtimeMode" | "interactionMode" | "session" | "latestTurn"
  >,
): MognetThreadSummary => ({
  threadId: thread.id,
  title: thread.title,
  modelSelection: thread.modelSelection,
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  sessionStatus: thread.session?.status ?? null,
  latestTurnState: thread.latestTurn?.state ?? null,
});

const formatThreadContext = (
  thread: OrchestrationThread,
  kind: "delegate" | "handoff",
  project: OrchestrationProjectShell,
): string => {
  const recentMessages = latestMessages(thread, 8)
    .map((message) => `### ${message.role} at ${message.createdAt}\n${message.text}`)
    .join("\n\n");
  const latestTurn = thread.latestTurn
    ? `Latest turn: ${thread.latestTurn.state} at ${thread.latestTurn.requestedAt}`
    : "Latest turn: none";
  const workspace =
    project.kind === "standalone"
      ? [
          "Scope: standalone chat",
          "Workspace project: not attached",
          "Branch: not applicable",
          "Repository: not applicable",
          "Project scripts: not applicable",
          latestTurn,
        ].join("\n")
      : [
          "Scope: workspace project",
          `Project: ${project.title}`,
          `Project ID: ${thread.projectId}`,
          `Workspace root: ${project.workspaceRoot}`,
          `Branch: ${thread.branch ?? "none"}`,
          `Worktree: ${thread.worktreePath ?? "none"}`,
          latestTurn,
        ].join("\n");
  const heading =
    kind === "handoff"
      ? "You are taking over this Mognet thread from summarized context."
      : "You are working in a delegated Mognet thread with summarized source context.";

  return [
    heading,
    "",
    "## Source Thread",
    `Title: ${thread.title}`,
    `Thread ID: ${thread.id}`,
    workspace,
    "",
    "## Recent Conversation",
    recentMessages || "No messages recorded.",
  ].join("\n");
};

const getCurrentThread = Effect.fn("MognetToolkit.getCurrentThread")(function* (operation: string) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const current = yield* query
    .getThreadDetailById(invocation.threadId)
    .pipe(Effect.mapError(toMognetError(operation)));
  return Option.getOrNull(current);
});

const getThreadOrFail = Effect.fn("MognetToolkit.getThreadOrFail")(function* (
  operation: string,
  threadId: ThreadId,
) {
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const thread = yield* query
    .getThreadDetailById(threadId)
    .pipe(Effect.mapError(toMognetError(operation)));
  if (Option.isNone(thread)) {
    return yield* new MognetMcpError({
      operation,
      message: `Thread '${threadId}' was not found.`,
    });
  }
  return thread.value;
});

const getProjectOrFail = Effect.fn("MognetToolkit.getProjectOrFail")(function* (
  operation: string,
  projectId: ProjectId,
) {
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const project = yield* query
    .getProjectShellById(projectId)
    .pipe(Effect.mapError(toMognetError(operation)));
  if (Option.isNone(project)) {
    return yield* new MognetMcpError({
      operation,
      message: `Project '${projectId}' was not found.`,
    });
  }
  return project.value;
});

const randomUuid = Effect.fn("MognetToolkit.randomUuid")(function* (operation: string) {
  const crypto = yield* Crypto.Crypto;
  return yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new MognetMcpError({
          operation,
          message: "Failed to generate identifier.",
          cause,
        }),
    ),
  );
});

const commandId = (operation: string) =>
  randomUuid(operation).pipe(Effect.map((uuid) => CommandId.make(`mcp:${operation}:${uuid}`)));

const resolveNewThreadTarget = Effect.fn("MognetToolkit.resolveNewThreadTarget")(function* (
  operation: string,
  input: {
    readonly projectId?: ProjectId | undefined;
    readonly standalone?: boolean | undefined;
    readonly modelSelection?: ModelSelection | undefined;
    readonly runtimeMode?: RuntimeMode | undefined;
    readonly interactionMode?: ProviderInteractionMode | undefined;
  },
) {
  const currentThread = yield* getCurrentThread(operation);
  if (input.projectId !== undefined && input.standalone === true) {
    return yield* new MognetMcpError({
      operation,
      message: "projectId cannot be combined with standalone=true.",
    });
  }

  const projectId =
    input.standalone === true
      ? STANDALONE_CHAT_PROJECT_ID
      : (input.projectId ?? currentThread?.projectId);
  if (!projectId) {
    return yield* new MognetMcpError({
      operation,
      message: "No target project was supplied and the current thread is unavailable.",
    });
  }

  const project =
    projectId === STANDALONE_CHAT_PROJECT_ID && input.standalone === true
      ? null
      : yield* getProjectOrFail(operation, projectId);
  const modelSelection =
    input.modelSelection ?? currentThread?.modelSelection ?? project?.defaultModelSelection ?? null;
  if (modelSelection === null) {
    return yield* new MognetMcpError({
      operation,
      message: "No modelSelection was supplied and no current/project default model is available.",
    });
  }

  return {
    currentThread,
    project,
    projectId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? currentThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode:
      input.interactionMode ?? currentThread?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
  };
});

const startThread = Effect.fn("MognetToolkit.startThread")(function* (
  input: MognetThreadStartInput,
  defaults?: {
    readonly operation?: string;
    readonly workspaceMode?: "local" | "worktree";
    readonly titleFallback?: string;
    readonly runSetupScript?: boolean;
  },
) {
  const operation = defaults?.operation ?? "thread_start";
  yield* requireOrchestration(operation);
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const dispatcher = yield* ThreadTurnBootstrapDispatcher.ThreadTurnBootstrapDispatcher;
  const target = yield* resolveNewThreadTarget(operation, input);
  const project =
    input.standalone === true
      ? null
      : (target.project ?? (yield* getProjectOrFail(operation, target.projectId)));
  const createdAt = yield* nowIso;
  const threadId = ThreadId.make(yield* randomUuid(operation));
  const workspaceMode = input.workspaceMode ?? defaults?.workspaceMode ?? "local";
  const title = input.title ?? deriveTitle(input.prompt, defaults?.titleFallback ?? "New thread");
  const messageId = MessageId.make(yield* randomUuid(operation));
  const runSetupScript = input.runSetupScript ?? defaults?.runSetupScript ?? false;

  let bootstrap: NonNullable<ThreadTurnStartCommand["bootstrap"]>;
  if (input.standalone === true) {
    bootstrap = {
      ensureStandaloneProject: true,
      createThread: {
        projectId: STANDALONE_CHAT_PROJECT_ID,
        title,
        modelSelection: target.modelSelection,
        runtimeMode: target.runtimeMode,
        interactionMode: target.interactionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      },
    };
  } else {
    if (project === null) {
      return yield* new MognetMcpError({
        operation,
        message: "Project resolution failed.",
      });
    }
    if (workspaceMode === "worktree") {
      if (project.kind !== "workspace") {
        return yield* new MognetMcpError({
          operation,
          message: "Worktree mode requires a workspace project.",
        });
      }
      const baseBranch = input.baseBranch ?? target.currentThread?.branch;
      if (!baseBranch) {
        return yield* new MognetMcpError({
          operation,
          message:
            "Worktree mode requires baseBranch when the current/source thread has no branch.",
        });
      }
      bootstrap = {
        createThread: {
          projectId: project.id,
          title,
          modelSelection: target.modelSelection,
          runtimeMode: target.runtimeMode,
          interactionMode: target.interactionMode,
          branch: baseBranch,
          worktreePath: null,
          createdAt,
        },
        prepareWorktree: {
          projectCwd: project.workspaceRoot,
          baseBranch,
          ...(input.startFromOrigin ? { startFromOrigin: true } : {}),
        },
        ...(runSetupScript ? { runSetupScript: true } : {}),
      };
    } else {
      bootstrap = {
        createThread: {
          projectId: project.id,
          title,
          modelSelection: target.modelSelection,
          runtimeMode: target.runtimeMode,
          interactionMode: target.interactionMode,
          branch: input.branch ?? target.currentThread?.branch ?? null,
          worktreePath: input.worktreePath ?? target.currentThread?.worktreePath ?? null,
          createdAt,
        },
      };
    }
  }

  const command: ThreadTurnStartCommand = {
    type: "thread.turn.start",
    commandId: yield* commandId(operation),
    threadId,
    message: {
      messageId,
      role: "user",
      text: input.prompt,
      attachments: [],
    },
    modelSelection: target.modelSelection,
    titleSeed: title,
    runtimeMode: target.runtimeMode,
    interactionMode: target.interactionMode,
    bootstrap,
    createdAt,
  };

  const result = yield* dispatcher
    .dispatch(command)
    .pipe(Effect.mapError(toMognetError(operation)));

  return {
    threadId,
    projectId:
      input.standalone === true || project?.kind === "standalone" ? null : target.projectId,
    scope:
      input.standalone === true
        ? standaloneChatScope()
        : project === null
          ? null
          : scopeFor(project, bootstrap.createThread),
    presentation: presentationForScope(
      input.standalone === true
        ? standaloneChatScope()
        : project === null
          ? null
          : scopeFor(project, bootstrap.createThread),
    ),
    sequence: result.sequence,
    route: routeFor({ environmentId: invocation.environmentId, threadId }),
  } satisfies MognetThreadCommandResult;
});

const projectContext = Effect.fn("MognetToolkit.projectContext")(function* () {
  yield* requireOrchestration("context");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const currentThread = yield* getCurrentThread("context");
  const shell = yield* query.getShellSnapshot().pipe(Effect.mapError(toMognetError("context")));
  const currentProject =
    currentThread === null
      ? null
      : Option.getOrNull(
          yield* query
            .getProjectShellById(currentThread.projectId)
            .pipe(Effect.mapError(toMognetError("context"))),
        );
  const projectThreads =
    currentThread === null
      ? []
      : shell.threads.filter((thread) => thread.projectId === currentThread.projectId);
  const currentScope =
    currentProject === null ? null : scopeFor(currentProject, currentThread ?? undefined);
  const isStandaloneScope = currentScope?.kind === "standalone-chat";

  return {
    environmentId: invocation.environmentId,
    currentThreadId: invocation.threadId,
    presentation: presentationForScope(currentScope),
    currentProject: isStandaloneScope ? null : currentProject,
    currentScope,
    currentThreadSummary: currentThread === null ? null : threadSummary(currentThread),
    currentThread: isStandaloneScope ? null : currentThread,
    hasOtherScopeThreads:
      currentThread === null
        ? false
        : projectThreads.some((thread) => thread.id !== currentThread.id),
    projects: isStandaloneScope ? [] : shell.projects,
    scopeThreads: isStandaloneScope ? [] : projectThreads,
    projectThreads: isStandaloneScope ? [] : projectThreads,
  } satisfies MognetProjectContextResult;
});

const threadsList = Effect.fn("MognetToolkit.threadsList")(function* (
  input: MognetThreadsListInput,
) {
  yield* requireOrchestration("threads_list");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const active = yield* query
    .getShellSnapshot()
    .pipe(Effect.mapError(toMognetError("threads_list")));
  const archived =
    input.includeArchived === true
      ? yield* query.getArchivedShellSnapshot().pipe(Effect.mapError(toMognetError("threads_list")))
      : { projects: [], threads: [] };
  const limit = input.limit ?? 50;
  const projectMap = new Map<string, OrchestrationProjectShell>();
  for (const project of [...active.projects, ...archived.projects]) {
    projectMap.set(project.id, project);
  }
  const currentThread =
    input.projectId === undefined
      ? Option.getOrNull(
          yield* query
            .getThreadShellById(invocation.threadId)
            .pipe(Effect.mapError(toMognetError("threads_list"))),
        )
      : null;
  const projectId = input.projectId ?? currentThread?.projectId;
  const threads = [...active.threads, ...archived.threads]
    .filter((thread) => projectId === undefined || thread.projectId === projectId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
  const projects = Array.from(
    new Map(
      threads
        .map((thread) => projectMap.get(thread.projectId))
        .filter((project): project is OrchestrationProjectShell => project !== undefined)
        .map((project) => [project.id, project]),
    ).values(),
  );
  const scopeProject = projectId === undefined ? null : (projectMap.get(projectId) ?? null);
  const scope = scopeProject === null ? null : scopeFor(scopeProject, currentThread);
  const isStandaloneScope = scope?.kind === "standalone-chat";
  return {
    currentThreadId: invocation.threadId,
    scope,
    presentation: presentationForScope(scope),
    threadSummaries: threads.map(threadSummary),
    projects: isStandaloneScope ? [] : projects,
    threads: isStandaloneScope ? [] : threads,
  } satisfies MognetThreadsListResult;
});

const threadStatus = Effect.fn("MognetToolkit.threadStatus")(function* (input: {
  readonly threadId?: ThreadId | undefined;
  readonly includeMessages?: boolean | undefined;
}) {
  yield* requireOrchestration("thread_status");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const threadId = input.threadId ?? invocation.threadId;
  const thread = yield* getThreadOrFail("thread_status", threadId);
  const project = yield* getProjectOrFail("thread_status", thread.projectId);
  const scope = scopeFor(project, thread);
  const isStandaloneScope = scope.kind === "standalone-chat";
  return {
    scope,
    presentation: presentationForScope(scope),
    threadSummary: threadSummary(thread),
    thread: isStandaloneScope ? null : thread,
    route: routeFor({ environmentId: invocation.environmentId, threadId }),
    recentMessages: input.includeMessages === true ? latestMessages(thread, 8) : [],
  } satisfies MognetThreadStatusResult;
});

const threadOpen = Effect.fn("MognetToolkit.threadOpen")(function* (input: {
  readonly threadId?: ThreadId | undefined;
}) {
  yield* requireOrchestration("thread_open");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const threadId = input.threadId ?? invocation.threadId;
  const thread = yield* query.getThreadShellById(threadId).pipe(
    Effect.mapError(toMognetError("thread_open")),
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () =>
          Effect.fail(
            new MognetMcpError({
              operation: "thread_open",
              message: `Thread '${threadId}' was not found.`,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
  const project = yield* getProjectOrFail("thread_open", thread.projectId);
  const scope = scopeFor(project, thread);
  const isStandaloneScope = scope.kind === "standalone-chat";
  return {
    scope,
    presentation: presentationForScope(scope),
    threadSummary: threadSummary(thread),
    thread: isStandaloneScope ? null : thread,
    route: routeFor({ environmentId: invocation.environmentId, threadId }),
  };
});

const delegateTask = Effect.fn("MognetToolkit.delegateTask")(function* (
  input: MognetDelegateTaskInput,
) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const includeSourceContext = input.includeSourceContext ?? true;
  const sourceThread = includeSourceContext
    ? yield* getThreadOrFail("delegate_task", input.sourceThreadId ?? invocation.threadId)
    : null;
  const fallbackThread =
    sourceThread === null && input.projectId === undefined
      ? yield* getCurrentThread("delegate_task")
      : null;
  const targetProjectId = input.projectId ?? sourceThread?.projectId ?? fallbackThread?.projectId;
  const targetProject =
    targetProjectId === undefined
      ? null
      : yield* getProjectOrFail("delegate_task", targetProjectId);
  const workspaceMode =
    input.workspaceMode ?? (targetProject?.kind === "standalone" ? "local" : "worktree");
  let prompt: string;
  if (sourceThread === null) {
    prompt = [
      "You are working in a delegated Mognet thread. Focus only on this task and report back with the outcome, blockers, and changed files.",
      "",
      input.prompt,
    ].join("\n");
  } else {
    const sourceProject =
      targetProject?.id === sourceThread.projectId
        ? targetProject
        : yield* getProjectOrFail("delegate_task", sourceThread.projectId);
    prompt = [
      formatThreadContext(sourceThread, "delegate", sourceProject),
      "",
      "## Delegated Task",
      input.prompt,
      "",
      "Report back with the outcome, blockers, and changed files.",
    ].join("\n");
  }
  return yield* startThread(
    {
      ...input,
      projectId: input.projectId ?? sourceThread?.projectId,
      title: input.title ?? (sourceThread ? `Delegate: ${sourceThread.title}` : undefined),
      prompt,
      modelSelection: input.modelSelection ?? sourceThread?.modelSelection,
      runtimeMode: input.runtimeMode ?? sourceThread?.runtimeMode,
      interactionMode: input.interactionMode ?? sourceThread?.interactionMode,
      branch: sourceThread?.branch ?? undefined,
      worktreePath: sourceThread?.worktreePath ?? undefined,
      workspaceMode,
      baseBranch: input.baseBranch ?? sourceThread?.branch ?? undefined,
      runSetupScript: input.runSetupScript ?? workspaceMode === "worktree",
    },
    {
      operation: "delegate_task",
      workspaceMode,
      titleFallback: "Delegated task",
      runSetupScript: workspaceMode === "worktree",
    },
  );
});

const handoffThread = Effect.fn("MognetToolkit.handoffThread")(function* (
  input: MognetThreadHandoffInput,
) {
  yield* requireOrchestration("thread_handoff");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const operation = "thread_handoff";
  const sourceThread = yield* getThreadOrFail(
    operation,
    input.sourceThreadId ?? invocation.threadId,
  );
  const sourceProject = yield* getProjectOrFail(operation, sourceThread.projectId);
  const basePrompt = formatThreadContext(sourceThread, "handoff", sourceProject);
  const prompt = [
    basePrompt,
    "",
    "## Instruction",
    input.prompt ??
      "Take over from this context. First state your understanding, then continue the work.",
  ].join("\n");

  return yield* startThread(
    {
      projectId: sourceThread.projectId,
      title: input.title ?? `Handoff: ${sourceThread.title}`,
      prompt,
      modelSelection: input.modelSelection ?? sourceThread.modelSelection,
      runtimeMode: input.runtimeMode ?? sourceThread.runtimeMode,
      interactionMode: input.interactionMode ?? sourceThread.interactionMode,
      branch: sourceThread.branch ?? undefined,
      worktreePath: sourceThread.worktreePath ?? undefined,
      workspaceMode: "local",
    },
    {
      operation,
      workspaceMode: "local",
      titleFallback: "Thread handoff",
    },
  );
});

const handlers = {
  mognet_project_context: () => projectContext(),
  mognet_threads_list: (input) => threadsList(input ?? {}),
  mognet_thread_status: (input) => threadStatus(input ?? {}),
  mognet_thread_start: (input) => startThread(input),
  mognet_thread_open: (input) => threadOpen(input ?? {}),
  mognet_scheduled_tasks_list: () =>
    Effect.gen(function* () {
      yield* requireScheduledTasks("scheduled_tasks_list");
      const scheduledTasks = yield* ScheduledTasks.ScheduledTasks;
      return yield* scheduledTasks.list.pipe(
        Effect.mapError(toMognetError("scheduled_tasks_list")),
      );
    }),
  mognet_scheduled_tasks_create: (input) =>
    Effect.gen(function* () {
      yield* requireScheduledTasks("scheduled_tasks_create");
      const scheduledTasks = yield* ScheduledTasks.ScheduledTasks;
      return yield* scheduledTasks
        .create(input)
        .pipe(Effect.mapError(toMognetError("scheduled_tasks_create")));
    }),
  mognet_scheduled_tasks_update: (input) =>
    Effect.gen(function* () {
      yield* requireScheduledTasks("scheduled_tasks_update");
      const scheduledTasks = yield* ScheduledTasks.ScheduledTasks;
      return yield* scheduledTasks
        .update(input)
        .pipe(Effect.mapError(toMognetError("scheduled_tasks_update")));
    }),
  mognet_scheduled_tasks_delete: (input) =>
    Effect.gen(function* () {
      yield* requireScheduledTasks("scheduled_tasks_delete");
      const scheduledTasks = yield* ScheduledTasks.ScheduledTasks;
      return yield* scheduledTasks
        .delete(input)
        .pipe(Effect.mapError(toMognetError("scheduled_tasks_delete")));
    }),
  mognet_scheduled_tasks_run_now: (input) =>
    Effect.gen(function* () {
      yield* requireScheduledTasks("scheduled_tasks_run_now");
      const scheduledTasks = yield* ScheduledTasks.ScheduledTasks;
      return yield* scheduledTasks
        .runNow(input)
        .pipe(Effect.mapError(toMognetError("scheduled_tasks_run_now")));
    }),
  mognet_delegate_task: (input) => delegateTask(input),
  mognet_thread_handoff: (input) => handoffThread(input ?? {}),
} satisfies Parameters<typeof MognetToolkit.toLayer>[0];

export const MognetToolkitHandlersLive = MognetToolkit.toLayer(handlers);
