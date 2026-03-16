import { Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const SubagentRunId = TrimmedNonEmptyString;
export type SubagentRunId = typeof SubagentRunId.Type;

export const SubagentSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  promptMarkdown: TrimmedNonEmptyString,
  summary: Schema.optional(TrimmedNonEmptyString),
});
export type SubagentSkill = typeof SubagentSkill.Type;

export const SubagentRunStatus = Schema.Literals([
  "preparing",
  "running",
  "report_ready",
  "accepted",
  "retained",
  "cleaned_up",
  "failed",
  "cleanup_failed",
]);
export type SubagentRunStatus = typeof SubagentRunStatus.Type;

export const SubagentReport = Schema.Struct({
  summary: TrimmedNonEmptyString,
  markdown: TrimmedNonEmptyString,
  findings: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  actionsTaken: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  recommendedActions: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  filesChanged: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  generatedAt: IsoDateTime,
});
export type SubagentReport = typeof SubagentReport.Type;

export const SubagentRun = Schema.Struct({
  id: SubagentRunId,
  parentThreadId: ThreadId,
  subagentThreadId: Schema.NullOr(ThreadId),
  skillId: TrimmedNonEmptyString,
  skillTitle: TrimmedNonEmptyString,
  task: TrimmedNonEmptyString,
  status: SubagentRunStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  report: Schema.NullOr(SubagentReport),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  acceptedAt: Schema.NullOr(IsoDateTime),
});
export type SubagentRun = typeof SubagentRun.Type;
