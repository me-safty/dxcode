import { Schema } from "effect";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Input for the `worktree_handoff` MCP tool.
 *
 * Creates a git worktree for the calling agent thread and re-points the
 * thread at it. The provider session restarts inside the worktree at the
 * start of the next turn, resuming the conversation.
 */
export const WorktreeHandoffInput = Schema.Struct({
  branch: TrimmedNonEmptyString.annotate({
    description: "Branch name to create for the worktree (e.g. 'feature/my-change').",
  }),
  baseRef: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Branch or ref the worktree branch starts from. Defaults to the branch currently checked out in the project workspace.",
    }),
  ),
  startFromOrigin: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Fetch origin and start the worktree branch from the remote-tracking commit of baseRef instead of the local ref. Defaults to the server's 'new worktrees start from origin' setting.",
    }),
  ),
  path: Schema.optional(
    TrimmedNonEmptyString.check(
      // Absolute POSIX (/...), Windows drive (C:\ or C:/), or UNC (\\host).
      Schema.isPattern(/^(?:[A-Za-z]:[\\/]|[\\/])/),
    ).annotate({
      description:
        "Absolute filesystem path for the new worktree. Relative paths are rejected. Defaults to the server-managed worktrees directory.",
    }),
  ),
  runSetupScript: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Run the project's configured setup script in the new worktree after handoff. Defaults to true.",
    }),
  ),
});
export type WorktreeHandoffInput = typeof WorktreeHandoffInput.Type;

export const WorktreeHandoffSetupScriptStatus = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("started"),
    scriptName: TrimmedNonEmptyString,
    terminalId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("no-script"),
  }),
  Schema.Struct({
    status: Schema.Literal("skipped"),
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    detail: Schema.String,
  }),
]);
export type WorktreeHandoffSetupScriptStatus = typeof WorktreeHandoffSetupScriptStatus.Type;

export const WorktreeHandoffResult = Schema.Struct({
  worktreePath: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  startedFromOrigin: Schema.Boolean,
  setupScript: WorktreeHandoffSetupScriptStatus,
  note: Schema.String,
});
export type WorktreeHandoffResult = typeof WorktreeHandoffResult.Type;

export class WorktreeCapabilityUnavailableError extends Schema.TaggedErrorClass<WorktreeCapabilityUnavailableError>()(
  "WorktreeCapabilityUnavailableError",
  {
    capability: Schema.Literal("worktree"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    providerSessionId: TrimmedNonEmptyString,
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return `Worktree tools are not available for this agent session.`;
  }
}

export class WorktreeThreadNotFoundError extends Schema.TaggedErrorClass<WorktreeThreadNotFoundError>()(
  "WorktreeThreadNotFoundError",
  {
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return `Thread '${this.threadId}' was not found.`;
  }
}

export class WorktreeProjectNotFoundError extends Schema.TaggedErrorClass<WorktreeProjectNotFoundError>()(
  "WorktreeProjectNotFoundError",
  {
    threadId: ThreadId,
    projectId: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Project '${this.projectId}' was not found for thread '${this.threadId}'.`;
  }
}

export class WorktreeHandoffAlreadyInWorktreeError extends Schema.TaggedErrorClass<WorktreeHandoffAlreadyInWorktreeError>()(
  "WorktreeHandoffAlreadyInWorktreeError",
  {
    threadId: ThreadId,
    worktreePath: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Thread '${this.threadId}' is already attached to worktree '${this.worktreePath}'.`;
  }
}

export class WorktreeHandoffInvalidRequestError extends Schema.TaggedErrorClass<WorktreeHandoffInvalidRequestError>()(
  "WorktreeHandoffInvalidRequestError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Worktree handoff request is invalid: ${this.detail}`;
  }
}

export class WorktreeOperationError extends Schema.TaggedErrorClass<WorktreeOperationError>()(
  "WorktreeOperationError",
  {
    operation: Schema.Literals([
      "resolveThread",
      "resolveProject",
      "resolveBaseRef",
      "fetchRemote",
      "resolveRemoteTrackingCommit",
      "createWorktree",
      "updateThreadMetadata",
      "resolveSettings",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Worktree operation '${this.operation}' failed.`;
  }
}

export const WorktreeHandoffError = Schema.Union([
  WorktreeCapabilityUnavailableError,
  WorktreeThreadNotFoundError,
  WorktreeProjectNotFoundError,
  WorktreeHandoffAlreadyInWorktreeError,
  WorktreeHandoffInvalidRequestError,
  WorktreeOperationError,
]);
export type WorktreeHandoffError = typeof WorktreeHandoffError.Type;

export const WorktreeStatusResult = Schema.Struct({
  attached: Schema.Boolean.annotate({
    description: "True when this thread is already attached to a git worktree.",
  }),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  projectWorkspaceRoot: TrimmedNonEmptyString.annotate({
    description: "Root of the project's main workspace checkout.",
  }),
  defaultStartFromOrigin: Schema.Boolean.annotate({
    description: "Server default used by worktree_handoff when startFromOrigin is omitted.",
  }),
});
export type WorktreeStatusResult = typeof WorktreeStatusResult.Type;

export const WorktreeStatusError = Schema.Union([
  WorktreeCapabilityUnavailableError,
  WorktreeThreadNotFoundError,
  WorktreeProjectNotFoundError,
  WorktreeOperationError,
]);
export type WorktreeStatusError = typeof WorktreeStatusError.Type;
