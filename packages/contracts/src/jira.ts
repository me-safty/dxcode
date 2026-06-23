// EMPOWERRD: fork-owned Jira contracts. Kept in a dedicated module so upstream
// syncs never touch it. Consumed by the fork RPC group (rpcJira.ts) and the
// server/web Jira feature modules.
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Canonical Jira issue-key shape, e.g. `PLAT-123`. */
export const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

/** A validated, normalized Jira issue key. */
export const JiraKey = TrimmedNonEmptyString.check(Schema.isPattern(JIRA_KEY_PATTERN));
export type JiraKey = typeof JiraKey.Type;

/** Input for the fork `jira.setThreadJiraKey` RPC. */
export const SetThreadJiraKeyInput = Schema.Struct({
  threadId: ThreadId,
  jiraKey: Schema.NullOr(JiraKey),
  renameBranch: Schema.Boolean,
});
export type SetThreadJiraKeyInput = typeof SetThreadJiraKeyInput.Type;

/**
 * A thread's Jira association as surfaced to the client. `branch` reflects the
 * thread's branch after any rename performed by the handler.
 */
export const ThreadJiraKey = Schema.Struct({
  threadId: ThreadId,
  jiraKey: Schema.NullOr(JiraKey),
  branch: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadJiraKey = typeof ThreadJiraKey.Type;

/** Result of `jira.listThreadJiraKeys` — one row per thread that has a key. */
export const ThreadJiraKeyList = Schema.Array(
  Schema.Struct({
    threadId: ThreadId,
    jiraKey: JiraKey,
  }),
);
export type ThreadJiraKeyList = typeof ThreadJiraKeyList.Type;

/** Jira settings surfaced to the web client (each field null when unset). */
export const ServerJiraConfig = Schema.Struct({
  domain: Schema.NullOr(TrimmedNonEmptyString),
  projectKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerJiraConfig = typeof ServerJiraConfig.Type;

/** Failure surfaced by the fork Jira RPC handlers (validation, main/master rule, git rename). */
export class JiraOperationError extends Schema.TaggedErrorClass<JiraOperationError>()(
  "JiraOperationError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
