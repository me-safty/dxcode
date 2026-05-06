import { Context, Effect, Layer, Schema } from "effect";
import type {
  KanbanConsoleAgentKind,
  KanbanConsoleAgentWorkflow,
  KanbanConsoleAgentWorkflowCommandId,
  KanbanConsoleAgentWorkflowSession,
  KanbanConsoleArtifact,
  KanbanConsoleGitStatusSnapshot,
  KanbanConsoleManagedRepo,
  KanbanConsoleProjectBoard,
  KanbanConsoleTask,
  KanbanConsoleTaskContextPackage,
} from "@t3tools/contracts";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const workflowCommandIds = [
  "init-project",
  "user-stories",
  "plan",
  "phase",
  "execute-task",
  "review",
  "open-pr",
  "ship",
  "extract-pr-learnings",
  "pdpl-audit",
  "ifrs-audit",
  "orchestrate",
] as const satisfies ReadonlyArray<KanbanConsoleAgentWorkflowCommandId>;

const workflowLabels: Record<KanbanConsoleAgentWorkflowCommandId, string> = {
  "execute-task": "Execute task",
  "extract-pr-learnings": "Extract PR learnings",
  "ifrs-audit": "IFRS audit",
  "init-project": "Initialize project",
  "open-pr": "Open PR",
  orchestrate: "Orchestrate next step",
  "pdpl-audit": "PDPL audit",
  phase: "Implement phase",
  plan: "Plan work",
  review: "Review",
  ship: "Ship readiness",
  "user-stories": "Draft user stories",
};

export class AgentWorkflowLauncherError extends Schema.TaggedErrorClass<AgentWorkflowLauncherError>()(
  "AgentWorkflowLauncherError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Agent workflow launcher failed in ${this.operation}: ${this.detail}`;
  }
}

export interface WorkflowRecipeOptions {
  readonly taskName: string;
  readonly phaseId?: string;
  readonly issueNumber?: number;
  readonly pullRequestNumber?: number;
  readonly claudeAvailable: boolean;
  readonly codexAvailable: boolean;
}

export interface TaskContextOptions {
  readonly task: KanbanConsoleTask;
  readonly board: KanbanConsoleProjectBoard;
  readonly repo: KanbanConsoleManagedRepo;
  readonly issueUrl: string;
  readonly prUrl?: string;
  readonly artifacts: ReadonlyArray<KanbanConsoleArtifact>;
  readonly gitStatus?: KanbanConsoleGitStatusSnapshot;
  readonly validationCommands?: ReadonlyArray<string>;
  readonly governanceRules?: ReadonlyArray<string>;
}

export interface QueueWorkflowOptions {
  readonly recipe: KanbanConsoleAgentWorkflow;
  readonly context: KanbanConsoleTaskContextPackage;
  readonly confirmed: boolean;
  readonly activeSessions?: ReadonlyArray<KanbanConsoleAgentWorkflowSession>;
  readonly now?: Date;
}

export interface AgentSessionCommentOptions {
  readonly cwd: string;
  readonly repository: string;
  readonly issueNumber: number;
  readonly session: KanbanConsoleAgentWorkflowSession;
  readonly event: "started" | "completed" | "failed" | "blocked";
  readonly confirmed: boolean;
}

export interface AgentWorkflowLauncherShape {
  readonly listRecipes: (input: WorkflowRecipeOptions) => ReadonlyArray<KanbanConsoleAgentWorkflow>;
  readonly buildTaskContext: (input: TaskContextOptions) => KanbanConsoleTaskContextPackage;
  readonly queueWorkflow: (
    input: QueueWorkflowOptions,
  ) => Effect.Effect<KanbanConsoleAgentWorkflowSession, AgentWorkflowLauncherError>;
  readonly postSessionComment: (
    input: AgentSessionCommentOptions,
  ) => Effect.Effect<void, AgentWorkflowLauncherError>;
}

export class AgentWorkflowLauncher extends Context.Service<
  AgentWorkflowLauncher,
  AgentWorkflowLauncherShape
>()("t3/kanban/AgentWorkflowLauncher") {}

function commandFor(
  commandId: KanbanConsoleAgentWorkflowCommandId,
  options: WorkflowRecipeOptions,
): string {
  switch (commandId) {
    case "init-project":
      return "/init-project";
    case "user-stories":
      return `/user-stories ${options.taskName} "<goal>"`;
    case "plan":
      return `/plan ${options.taskName} "<goal>"`;
    case "phase":
      return `/phase ${options.taskName} ${options.phaseId ?? "phase-1"}`;
    case "execute-task":
      return `/execute-task ${options.issueNumber ?? "<issue-number>"}`;
    case "review":
      return "/review";
    case "open-pr":
      return `/open-pr feat ${options.taskName}`;
    case "ship":
      return `/ship ${options.taskName}`;
    case "extract-pr-learnings":
      return `/extract-pr-learnings ${options.pullRequestNumber ?? "<pr-number>"}`;
    case "pdpl-audit":
      return "/pdpl-audit";
    case "ifrs-audit":
      return "/ifrs-audit";
    case "orchestrate":
      return `/orchestrate ${options.taskName}`;
  }
}

function recipeId(agent: Exclude<KanbanConsoleAgentKind, "Human">, commandId: string): string {
  return `${agent.toLowerCase()}-${commandId}`;
}

export function listWorkflowRecipes(
  options: WorkflowRecipeOptions,
): ReadonlyArray<KanbanConsoleAgentWorkflow> {
  return workflowCommandIds.flatMap((commandId) => {
    const command = commandFor(commandId, options);
    return [
      {
        id: recipeId("Claude", commandId),
        label: `Claude ${workflowLabels[commandId]}`,
        agent: "Claude" as const,
        command,
        commandId,
        available: options.claudeAvailable,
      },
      {
        id: recipeId("Codex", commandId),
        label: `Codex ${workflowLabels[commandId]}`,
        agent: "Codex" as const,
        command,
        commandId,
        available: options.codexAvailable,
      },
    ];
  });
}

export function buildTaskContext(input: TaskContextOptions): KanbanConsoleTaskContextPackage {
  return {
    task: {
      id: input.task.id,
      issue: input.task.issue,
      title: input.task.title,
      repo: input.task.repo,
      column: input.task.column,
      priority: input.task.priority,
    },
    project: {
      id: input.board.id,
      owner: input.board.owner,
      title: input.board.title,
    },
    repo: {
      id: input.repo.id,
      owner: input.repo.owner,
      name: input.repo.name,
      path: input.repo.path,
      branch: input.repo.branch,
    },
    issueUrl: input.issueUrl,
    ...(input.prUrl ? { prUrl: input.prUrl } : {}),
    artifacts: input.artifacts.map((artifact) => ({
      path: artifact.path,
      status: artifact.status,
    })),
    ...(input.gitStatus ? { gitStatus: input.gitStatus } : {}),
    validationCommands: input.validationCommands ?? ["bun check"],
    governanceRules: input.governanceRules ?? [
      "AGENTS.md",
      "docs/project.md",
      "review.md",
      ".cursor/BUGBOT.md",
      ".ai/rules/22-kanban-console.md",
    ],
  };
}

function duplicateKey(input: QueueWorkflowOptions): string {
  return [
    input.context.task.id,
    input.recipe.id,
    input.context.task.column,
    input.context.repo.branch,
  ].join(":");
}

function activeDuplicate(
  input: QueueWorkflowOptions,
): KanbanConsoleAgentWorkflowSession | undefined {
  const key = duplicateKey(input);
  return input.activeSessions?.find(
    (session) =>
      session.duplicateKey === key && (session.status === "queued" || session.status === "running"),
  );
}

function isoNow(input: QueueWorkflowOptions): string {
  return (input.now ?? new Date()).toISOString();
}

export function queueWorkflowSession(
  input: QueueWorkflowOptions,
): Effect.Effect<KanbanConsoleAgentWorkflowSession, AgentWorkflowLauncherError> {
  if (!input.confirmed) {
    return Effect.fail(
      new AgentWorkflowLauncherError({
        operation: "queueWorkflow",
        detail: "Agent workflow launches require explicit confirmation.",
      }),
    );
  }

  if (!input.recipe.available) {
    return Effect.succeed({
      id: `blocked-${input.context.task.id}-${input.recipe.id}`,
      taskId: input.context.task.id,
      workflowId: input.recipe.id,
      agent: input.recipe.agent,
      command: input.recipe.command,
      status: "blocked",
      duplicateKey: duplicateKey(input),
      duplicateSuppressed: false,
      summary: `${input.recipe.agent} workflow is unavailable on this machine.`,
      startedAt: isoNow(input),
      finishedAt: isoNow(input),
    });
  }

  const duplicate = activeDuplicate(input);
  if (duplicate) {
    return Effect.succeed({
      ...duplicate,
      duplicateSuppressed: true,
      summary:
        "Duplicate agent workflow suppressed; an equivalent session is already queued or running.",
    });
  }

  return Effect.succeed({
    id: `agent-${input.context.task.id}-${input.recipe.id}-${isoNow(input).replace(/[:.]/g, "-")}`,
    taskId: input.context.task.id,
    workflowId: input.recipe.id,
    agent: input.recipe.agent,
    command: input.recipe.command,
    status: "queued",
    duplicateKey: duplicateKey(input),
    duplicateSuppressed: false,
    summary: `${input.recipe.agent} workflow queued with a redacted task context package.`,
    startedAt: isoNow(input),
  });
}

export function sessionCommentBody(input: {
  readonly session: KanbanConsoleAgentWorkflowSession;
  readonly event: AgentSessionCommentOptions["event"];
}): string {
  const verb = {
    blocked: "blocked",
    completed: "completed",
    failed: "failed",
    started: "started",
  }[input.event];

  return [
    `Kanban Console agent workflow ${verb}.`,
    "",
    `- Task: ${input.session.taskId}`,
    `- Agent: ${input.session.agent}`,
    `- Command: ${input.session.command}`,
    `- Status: ${input.session.status}`,
    `- Summary: ${input.session.summary}`,
    "",
    "Raw command output is intentionally omitted.",
  ].join("\n");
}

function launcherError(
  operation: string,
  cause: GitHubCli.GitHubCliError,
): AgentWorkflowLauncherError {
  return new AgentWorkflowLauncherError({
    operation,
    detail: cause.detail,
    cause,
  });
}

export const make = Effect.fn("makeAgentWorkflowLauncher")(function* () {
  const github = yield* GitHubCli.GitHubCli;

  return AgentWorkflowLauncher.of({
    listRecipes: listWorkflowRecipes,
    buildTaskContext,
    queueWorkflow: queueWorkflowSession,
    postSessionComment: (input) => {
      if (!input.confirmed) {
        return Effect.fail(
          new AgentWorkflowLauncherError({
            operation: "postSessionComment",
            detail: "GitHub issue comments for agent sessions require explicit confirmation.",
          }),
        );
      }

      return github
        .execute({
          cwd: input.cwd,
          args: [
            "issue",
            "comment",
            String(input.issueNumber),
            "--repo",
            input.repository,
            "--body",
            sessionCommentBody({ session: input.session, event: input.event }),
          ],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => launcherError("postSessionComment", error)),
        );
    },
  });
});

export const layer = Layer.effect(AgentWorkflowLauncher, make());
