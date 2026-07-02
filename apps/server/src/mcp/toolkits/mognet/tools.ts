import {
  ModelSelection,
  NonNegativeInt,
  OrchestrationProjectShell,
  OrchestrationThread,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ScheduledTaskCreateInput,
  ScheduledTaskDeleteInput,
  ScheduledTaskDeleteResult,
  ScheduledTaskListResult,
  ScheduledTaskMutationResult,
  ScheduledTaskUpdateInput,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as ScheduledTasks from "../../../scheduledTasks.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnBootstrapDispatcher from "../../../orchestration/ThreadTurnBootstrapDispatcher.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ThreadTurnBootstrapDispatcher.ThreadTurnBootstrapDispatcher,
  ScheduledTasks.ScheduledTasks,
  Crypto.Crypto,
];

const OptionalThreadId = Schema.optional(
  ThreadId.annotate({
    description: "Thread to inspect. Omit to use this agent session's current thread.",
  }),
).annotate({
  description: "Thread to inspect. Omit to use this agent session's current thread.",
});

const OptionalProjectId = Schema.optional(
  ProjectId.annotate({
    description:
      "Workspace project or standalone chat container to target. Omit to use the current thread's scope, unless standalone is true.",
  }),
).annotate({
  description:
    "Workspace project or standalone chat container to target. Omit to use the current thread's scope, unless standalone is true.",
});

const OptionalModelSelection = Schema.optional(
  ModelSelection.annotate({
    description:
      "Provider instance and model for the new thread. Omit to inherit from the source thread or project default.",
  }),
).annotate({
  description:
    "Provider instance and model for the new thread. Omit to inherit from the source thread or project default.",
});

const OptionalRuntimeMode = Schema.optional(
  RuntimeMode.annotate({
    description:
      "Runtime access mode. Omit to inherit from the source thread, or use the server default.",
  }),
).annotate({
  description:
    "Runtime access mode. Omit to inherit from the source thread, or use the server default.",
});

const OptionalInteractionMode = Schema.optional(
  ProviderInteractionMode.annotate({
    description:
      "Interaction mode for the new thread. Omit to inherit from the source thread, or use default mode.",
  }),
).annotate({
  description:
    "Interaction mode for the new thread. Omit to inherit from the source thread, or use default mode.",
});

const OptionalTitle = Schema.optional(
  TrimmedNonEmptyString.check(Schema.isMaxLength(160)).annotate({
    description: "Thread title. Omit on prompt-start tools to derive a compact title.",
  }),
).annotate({
  description: "Thread title. Omit on prompt-start tools to derive a compact title.",
});

const Prompt = TrimmedNonEmptyString.check(Schema.isMaxLength(120_000)).annotate({
  description: "Prompt to send as the first user message in the new thread.",
});

const WorkspaceMode = Schema.Literals(["local", "worktree"]).annotate({
  description:
    "Workspace mode for create-and-start operations. local reuses a known workspace path; worktree creates a new isolated Git worktree for workspace projects.",
});

const CommonNewThreadFields = {
  projectId: OptionalProjectId,
  standalone: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Create under Mognet's standalone chat scope. Cannot be combined with projectId.",
    }),
  ).annotate({
    description: "Create under Mognet's standalone chat scope. Cannot be combined with projectId.",
  }),
  modelSelection: OptionalModelSelection,
  runtimeMode: OptionalRuntimeMode,
  interactionMode: OptionalInteractionMode,
  branch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Branch label to store on the new thread when using local workspace mode.",
    }),
  ).annotate({
    description: "Branch label to store on the new thread when using local workspace mode.",
  }),
  worktreePath: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Existing worktree path to attach to the new thread when using local workspace mode.",
    }),
  ).annotate({
    description:
      "Existing worktree path to attach to the new thread when using local workspace mode.",
  }),
};

export const MognetProjectContextInput = Tool.EmptyParams;
export type MognetProjectContextInput = typeof MognetProjectContextInput.Type;

export const MognetThreadsListInput = Schema.Struct({
  projectId: OptionalProjectId,
  includeArchived: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include archived thread shell rows. Defaults to false.",
    }),
  ).annotate({
    description: "Include archived thread shell rows. Defaults to false.",
  }),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0))
      .check(Schema.isLessThanOrEqualTo(100))
      .annotate({ description: "Maximum threads to return. Defaults to 50; maximum 100." }),
  ).annotate({
    description: "Maximum threads to return. Defaults to 50; maximum 100.",
  }),
});
export type MognetThreadsListInput = typeof MognetThreadsListInput.Type;

export const MognetThreadStatusInput = Schema.Struct({
  threadId: OptionalThreadId,
  includeMessages: Schema.optional(
    Schema.Boolean.annotate({
      description: "Include the latest compact message excerpts. Defaults to false.",
    }),
  ).annotate({
    description: "Include the latest compact message excerpts. Defaults to false.",
  }),
});
export type MognetThreadStatusInput = typeof MognetThreadStatusInput.Type;

export const MognetThreadStartInput = Schema.Struct({
  ...CommonNewThreadFields,
  title: OptionalTitle,
  prompt: Prompt,
  workspaceMode: Schema.optional(WorkspaceMode).annotate({
    description: "Workspace mode. Defaults to local; use worktree for an isolated Git worktree.",
  }),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Base branch or ref for workspaceMode=worktree. Required when a source branch cannot be inferred.",
    }),
  ).annotate({
    description:
      "Base branch or ref for workspaceMode=worktree. Required when a source branch cannot be inferred.",
  }),
  startFromOrigin: Schema.optional(
    Schema.Boolean.annotate({
      description: "Fetch origin and create the worktree from the remote-tracking commit.",
    }),
  ).annotate({
    description: "Fetch origin and create the worktree from the remote-tracking commit.",
  }),
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description: "Run the project's setup script after creating a new worktree.",
    }),
  ).annotate({
    description: "Run the project's setup script after creating a new worktree.",
  }),
});
export type MognetThreadStartInput = typeof MognetThreadStartInput.Type;

export const MognetThreadOpenInput = Schema.Struct({
  threadId: OptionalThreadId,
});
export type MognetThreadOpenInput = typeof MognetThreadOpenInput.Type;

export const MognetDelegateTaskInput = Schema.Struct({
  projectId: OptionalProjectId,
  sourceThreadId: Schema.optional(
    ThreadId.annotate({
      description:
        "Thread whose compact context should be copied into the delegated task. Defaults to the current thread when includeSourceContext is not false.",
    }),
  ).annotate({
    description:
      "Thread whose compact context should be copied into the delegated task. Defaults to the current thread when includeSourceContext is not false.",
  }),
  title: OptionalTitle,
  prompt: Prompt,
  modelSelection: OptionalModelSelection,
  runtimeMode: OptionalRuntimeMode,
  interactionMode: OptionalInteractionMode,
  workspaceMode: Schema.optional(WorkspaceMode).annotate({
    description:
      "Workspace mode for the delegated thread. Defaults to worktree for isolation; use local to continue in the source thread's workspace without creating a new Git worktree.",
  }),
  includeSourceContext: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Copy compact source-thread context into the delegated prompt. Defaults to true; set false for a standalone subtask.",
    }),
  ).annotate({
    description:
      "Copy compact source-thread context into the delegated prompt. Defaults to true; set false for a standalone subtask.",
  }),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Base branch or ref for the delegated worktree. Omit to inherit the current thread branch.",
    }),
  ).annotate({
    description:
      "Base branch or ref for the delegated worktree. Omit to inherit the current thread branch.",
  }),
  startFromOrigin: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Fetch origin and create the delegated worktree from the remote-tracking commit.",
    }),
  ).annotate({
    description: "Fetch origin and create the delegated worktree from the remote-tracking commit.",
  }),
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description: "Run the project's setup script after creating the delegated worktree.",
    }),
  ).annotate({
    description: "Run the project's setup script after creating the delegated worktree.",
  }),
});
export type MognetDelegateTaskInput = typeof MognetDelegateTaskInput.Type;

export const MognetThreadHandoffInput = Schema.Struct({
  sourceThreadId: OptionalThreadId,
  title: OptionalTitle,
  prompt: Schema.optional(Prompt).annotate({
    description:
      "Specific handoff instruction for the recipient thread. Omit to ask it to take over from summarized context.",
  }),
  modelSelection: OptionalModelSelection,
  runtimeMode: OptionalRuntimeMode,
  interactionMode: OptionalInteractionMode,
});
export type MognetThreadHandoffInput = typeof MognetThreadHandoffInput.Type;

export const MognetScheduledTasksListInput = Tool.EmptyParams;
export type MognetScheduledTasksListInput = typeof MognetScheduledTasksListInput.Type;

export const MognetRoute = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  threadId: ThreadId,
  routePath: TrimmedNonEmptyString,
});
export type MognetRoute = typeof MognetRoute.Type;

export const MognetScope = Schema.Struct({
  kind: Schema.Literals(["workspace-project", "standalone-chat"]),
  containerId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  workspaceRoot: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  repositoryApplicable: Schema.Boolean,
  scriptsApplicable: Schema.Boolean,
  presentation: TrimmedNonEmptyString,
});
export type MognetScope = typeof MognetScope.Type;

export const MognetPresentationPolicy = Schema.Struct({
  scopeKind: Schema.Literals(["workspace-project", "standalone-chat"]),
  publicLabel: TrimmedNonEmptyString,
  exposeInternalContainerId: Schema.Boolean,
  exposeWorkspacePath: Schema.Boolean,
  exposeBranch: Schema.Boolean,
  exposeThreadCounts: Schema.Boolean,
  exposeRoute: Schema.Boolean,
  responseGuidance: TrimmedNonEmptyString,
});
export type MognetPresentationPolicy = typeof MognetPresentationPolicy.Type;

export const MognetThreadSummary = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sessionStatus: Schema.NullOr(TrimmedNonEmptyString),
  latestTurnState: Schema.NullOr(TrimmedNonEmptyString),
});
export type MognetThreadSummary = typeof MognetThreadSummary.Type;

export const MognetThreadCommandResult = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  scope: Schema.NullOr(MognetScope),
  presentation: Schema.NullOr(MognetPresentationPolicy),
  sequence: NonNegativeInt,
  route: MognetRoute,
});
export type MognetThreadCommandResult = typeof MognetThreadCommandResult.Type;

const CompactMessage = Schema.Struct({
  role: TrimmedNonEmptyString,
  createdAt: TrimmedNonEmptyString,
  text: Schema.String,
});

export const MognetThreadStatusResult = Schema.Struct({
  scope: Schema.NullOr(MognetScope),
  presentation: Schema.NullOr(MognetPresentationPolicy),
  threadSummary: MognetThreadSummary,
  thread: Schema.NullOr(OrchestrationThread),
  route: MognetRoute,
  recentMessages: Schema.Array(CompactMessage),
});
export type MognetThreadStatusResult = typeof MognetThreadStatusResult.Type;

export const MognetThreadsListResult = Schema.Struct({
  currentThreadId: ThreadId,
  scope: Schema.NullOr(MognetScope),
  presentation: Schema.NullOr(MognetPresentationPolicy),
  threadSummaries: Schema.Array(MognetThreadSummary),
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
});
export type MognetThreadsListResult = typeof MognetThreadsListResult.Type;

export const MognetProjectContextResult = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  currentThreadId: ThreadId,
  presentation: Schema.NullOr(MognetPresentationPolicy),
  currentProject: Schema.NullOr(OrchestrationProjectShell),
  currentScope: Schema.NullOr(MognetScope),
  currentThreadSummary: Schema.NullOr(MognetThreadSummary),
  currentThread: Schema.NullOr(OrchestrationThread),
  hasOtherScopeThreads: Schema.Boolean,
  projects: Schema.Array(OrchestrationProjectShell),
  scopeThreads: Schema.Array(OrchestrationThreadShell),
  projectThreads: Schema.Array(OrchestrationThreadShell),
});
export type MognetProjectContextResult = typeof MognetProjectContextResult.Type;

export const MognetOpenThreadResult = Schema.Struct({
  scope: Schema.NullOr(MognetScope),
  presentation: Schema.NullOr(MognetPresentationPolicy),
  threadSummary: MognetThreadSummary,
  thread: Schema.NullOr(OrchestrationThreadShell),
  route: MognetRoute,
});
export type MognetOpenThreadResult = typeof MognetOpenThreadResult.Type;

export class MognetMcpError extends Schema.TaggedErrorClass<MognetMcpError>()("MognetMcpError", {
  operation: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true) as T;

const safeMutationTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.Readonly, false).annotate(Tool.Destructive, false) as T;

const destructiveTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.Readonly, false).annotate(Tool.Destructive, true) as T;

export const MognetProjectContextTool = readonlyTool(
  Tool.make("mognet_project_context", {
    description:
      "Read the current Mognet environment, current thread, current scope, and orientation-safe thread metadata before taking workflow actions. If currentScope.kind is standalone-chat, present it as a chat scope, not a project. Do not mention internal project IDs, chat workspace paths, null branch values, routes, or exact thread counts unless the user explicitly asks for raw/internal diagnostics.",
    parameters: MognetProjectContextInput,
    success: MognetProjectContextResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Get Mognet context"),
);

export const MognetThreadsListTool = readonlyTool(
  Tool.make("mognet_threads_list", {
    description:
      "List Mognet threads only when the user asks to list or enumerate threads. Defaults to the current workspace project or standalone chat scope; pass projectId only to target another container. If scope.kind is standalone-chat, describe the result as chat threads, not project threads, and prefer threadSummaries over raw thread records.",
    parameters: MognetThreadsListInput,
    success: MognetThreadsListResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "List Mognet threads"),
);

export const MognetThreadStatusTool = readonlyTool(
  Tool.make("mognet_thread_status", {
    description:
      "Inspect one Mognet thread's status, session state, latest turn state, scope binding, and optional recent message excerpts. For standalone chat scopes, use threadSummary and do not mention internal project IDs, chat workspace paths, null branch values, or routes unless the user asks for raw/internal diagnostics.",
    parameters: MognetThreadStatusInput,
    success: MognetThreadStatusResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Get Mognet thread status"),
);

export const MognetThreadStartTool = safeMutationTool(
  Tool.make("mognet_thread_start", {
    description:
      "Create a new Mognet thread and immediately send its first user prompt. Use this for direct requests to start a new thread from a prompt; set standalone=true for a standalone chat. Use delegate or handoff only when the user explicitly asks to copy context or transfer work.",
    parameters: MognetThreadStartInput,
    success: MognetThreadCommandResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Start Mognet thread"),
);

export const MognetThreadOpenTool = readonlyTool(
  Tool.make("mognet_thread_open", {
    description:
      "Resolve a Mognet thread route and scope only when the user explicitly asks to open, navigate to, link to, or show the route for a thread. Do not call this for general context/status answers.",
    parameters: MognetThreadOpenInput,
    success: MognetOpenThreadResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Resolve Mognet thread route"),
);

export const MognetScheduledTasksListTool = readonlyTool(
  Tool.make("mognet_scheduled_tasks_list", {
    description:
      "List configured Mognet scheduled agent tasks, including next run time, last status, and last run thread. Tasks with target.type=standalone run in the standalone chat scope, not a workspace project.",
    parameters: MognetScheduledTasksListInput,
    success: ScheduledTaskListResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "List scheduled tasks"),
);

export const MognetScheduledTasksCreateTool = safeMutationTool(
  Tool.make("mognet_scheduled_tasks_create", {
    description:
      "Create a recurring Mognet scheduled agent task using the same schema as the settings UI. Use target.type=standalone for chat-scope tasks and target.type=project for workspace project tasks.",
    parameters: ScheduledTaskCreateInput,
    success: ScheduledTaskMutationResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Create scheduled task"),
);

export const MognetScheduledTasksUpdateTool = safeMutationTool(
  Tool.make("mognet_scheduled_tasks_update", {
    description:
      "Update an existing Mognet scheduled agent task by id. target.type=standalone means standalone chat scope, not a workspace project.",
    parameters: ScheduledTaskUpdateInput,
    success: ScheduledTaskMutationResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Update scheduled task"),
);

export const MognetScheduledTasksDeleteTool = destructiveTool(
  Tool.make("mognet_scheduled_tasks_delete", {
    description: "Delete an existing Mognet scheduled agent task by id.",
    parameters: ScheduledTaskDeleteInput,
    success: ScheduledTaskDeleteResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Delete scheduled task"),
);

export const MognetScheduledTasksRunNowTool = safeMutationTool(
  Tool.make("mognet_scheduled_tasks_run_now", {
    description:
      "Run a Mognet scheduled agent task immediately and return the updated task snapshot. Preserve standalone-chat vs workspace-project wording from the task target.",
    parameters: ScheduledTaskDeleteInput,
    success: ScheduledTaskMutationResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Run scheduled task now"),
);

export const MognetDelegateTaskTool = safeMutationTool(
  Tool.make("mognet_delegate_task", {
    description:
      "Delegate a task to a fresh Mognet thread, optionally copying compact context from a source thread. Defaults to an isolated worktree for workspace projects; standalone chat scopes use local mode because Git worktrees are not applicable.",
    parameters: MognetDelegateTaskInput,
    success: MognetThreadCommandResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Delegate task to Mognet thread"),
);

export const MognetThreadHandoffTool = safeMutationTool(
  Tool.make("mognet_thread_handoff", {
    description:
      "Create a new Mognet thread for another provider or model to take over from a compact source-thread handoff context. Use only when the user explicitly asks to hand off work or transfer context; preserve standalone-chat vs workspace-project wording from the source.",
    parameters: MognetThreadHandoffInput,
    success: MognetThreadCommandResult,
    failure: MognetMcpError,
    dependencies,
  }).annotate(Tool.Title, "Handoff Mognet thread"),
);

export const MognetToolkit = Toolkit.make(
  MognetProjectContextTool,
  MognetThreadsListTool,
  MognetThreadStatusTool,
  MognetThreadStartTool,
  MognetThreadOpenTool,
  MognetScheduledTasksListTool,
  MognetScheduledTasksCreateTool,
  MognetScheduledTasksUpdateTool,
  MognetScheduledTasksDeleteTool,
  MognetScheduledTasksRunNowTool,
  MognetDelegateTaskTool,
  MognetThreadHandoffTool,
);
