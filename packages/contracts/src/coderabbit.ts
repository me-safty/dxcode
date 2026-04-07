import { Schema } from "effect";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const CodeRabbitReviewId = TrimmedNonEmptyString.pipe(Schema.brand("CodeRabbitReviewId"));
export type CodeRabbitReviewId = typeof CodeRabbitReviewId.Type;

export const CodeRabbitFindingId = TrimmedNonEmptyString.pipe(Schema.brand("CodeRabbitFindingId"));
export type CodeRabbitFindingId = typeof CodeRabbitFindingId.Type;

export const CodeRabbitReviewScope = Schema.Literals(["all", "committed", "uncommitted"]);
export type CodeRabbitReviewScope = typeof CodeRabbitReviewScope.Type;

export const CodeRabbitReviewPhase = Schema.Literals([
  "starting",
  "connecting",
  "setup",
  "analyzing",
  "completed",
  "errored",
  "cancelled",
]);
export type CodeRabbitReviewPhase = typeof CodeRabbitReviewPhase.Type;

export const CodeRabbitFindingSeverity = Schema.Literals([
  "info",
  "trivial",
  "minor",
  "major",
  "critical",
]);
export type CodeRabbitFindingSeverity = typeof CodeRabbitFindingSeverity.Type;

const CodeRabbitFindingLineRange = Schema.Struct({
  start: PositiveInt,
  end: PositiveInt,
});

const CodeRabbitFindingLocationFile = Schema.Struct({
  type: Schema.Literal("file"),
  filePath: TrimmedNonEmptyString,
});

const CodeRabbitFindingLocationLine = Schema.Struct({
  type: Schema.Literal("line"),
  filePath: TrimmedNonEmptyString,
  lineNumber: PositiveInt,
  lineRange: Schema.optional(CodeRabbitFindingLineRange),
});

export const CodeRabbitFindingLocation = Schema.Union([
  CodeRabbitFindingLocationFile,
  CodeRabbitFindingLocationLine,
]);
export type CodeRabbitFindingLocation = typeof CodeRabbitFindingLocation.Type;

export const CodeRabbitFinding = Schema.Struct({
  id: CodeRabbitFindingId,
  severity: CodeRabbitFindingSeverity,
  summary: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  location: CodeRabbitFindingLocation,
  codegenInstructions: Schema.String,
  suggestions: Schema.Array(Schema.String),
  sourceEventType: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type CodeRabbitFinding = typeof CodeRabbitFinding.Type;

export const CodeRabbitReviewSnapshot = Schema.Struct({
  reviewId: CodeRabbitReviewId,
  cwd: TrimmedNonEmptyString,
  scope: CodeRabbitReviewScope,
  phase: CodeRabbitReviewPhase,
  statusText: Schema.NullOr(Schema.String),
  currentBranch: Schema.NullOr(TrimmedNonEmptyString),
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  findings: Schema.Array(CodeRabbitFinding),
  degraded: Schema.Boolean,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  errorMessage: Schema.NullOr(Schema.String),
});
export type CodeRabbitReviewSnapshot = typeof CodeRabbitReviewSnapshot.Type;

export const CodeRabbitReviewStatus = Schema.Struct({
  available: Schema.Boolean,
  authenticated: Schema.Boolean,
  activeReviewId: Schema.NullOr(CodeRabbitReviewId),
  latestReviewId: Schema.NullOr(CodeRabbitReviewId),
});
export type CodeRabbitReviewStatus = typeof CodeRabbitReviewStatus.Type;

export const CodeRabbitStartReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  scope: CodeRabbitReviewScope,
  baseBranch: Schema.optional(TrimmedNonEmptyString),
});
export type CodeRabbitStartReviewInput = typeof CodeRabbitStartReviewInput.Type;

export const CodeRabbitStartReviewResult = Schema.Struct({
  reviewId: CodeRabbitReviewId,
});
export type CodeRabbitStartReviewResult = typeof CodeRabbitStartReviewResult.Type;

export const CodeRabbitCancelReviewInput = Schema.Struct({
  reviewId: CodeRabbitReviewId,
});
export type CodeRabbitCancelReviewInput = typeof CodeRabbitCancelReviewInput.Type;

export const CodeRabbitGetStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type CodeRabbitGetStatusInput = typeof CodeRabbitGetStatusInput.Type;

export const CodeRabbitGetReviewInput = Schema.Struct({
  reviewId: CodeRabbitReviewId,
});
export type CodeRabbitGetReviewInput = typeof CodeRabbitGetReviewInput.Type;

export const CodeRabbitFixWithAiInput = Schema.Struct({
  reviewId: CodeRabbitReviewId,
  findingIds: Schema.Array(CodeRabbitFindingId).check(Schema.isMinLength(1)),
  projectId: ProjectId,
  sourceThreadId: Schema.optional(ThreadId),
});
export type CodeRabbitFixWithAiInput = typeof CodeRabbitFixWithAiInput.Type;

export const CodeRabbitFixWithAiResult = Schema.Struct({
  threadId: ThreadId,
});
export type CodeRabbitFixWithAiResult = typeof CodeRabbitFixWithAiResult.Type;

const CodeRabbitReviewEventBase = {
  reviewId: CodeRabbitReviewId,
  timestamp: IsoDateTime,
};

export const CodeRabbitReviewEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    ...CodeRabbitReviewEventBase,
    snapshot: CodeRabbitReviewSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("status_updated"),
    ...CodeRabbitReviewEventBase,
    phase: CodeRabbitReviewPhase,
    statusText: Schema.NullOr(Schema.String),
    degraded: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("finding_added"),
    ...CodeRabbitReviewEventBase,
    finding: CodeRabbitFinding,
  }),
  Schema.Struct({
    type: Schema.Literal("completed"),
    ...CodeRabbitReviewEventBase,
    snapshot: CodeRabbitReviewSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("errored"),
    ...CodeRabbitReviewEventBase,
    message: TrimmedNonEmptyString,
    snapshot: CodeRabbitReviewSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("cancelled"),
    ...CodeRabbitReviewEventBase,
    reason: Schema.optional(TrimmedNonEmptyString),
    snapshot: CodeRabbitReviewSnapshot,
  }),
]);
export type CodeRabbitReviewEvent = typeof CodeRabbitReviewEvent.Type;

export const CodeRabbitRpcErrorReason = Schema.Literals([
  "cli_unavailable",
  "not_authenticated",
  "review_not_found",
  "review_not_active",
  "invalid_request",
  "process_failed",
]);
export type CodeRabbitRpcErrorReason = typeof CodeRabbitRpcErrorReason.Type;

export class CodeRabbitRpcError extends Schema.TaggedErrorClass<CodeRabbitRpcError>()(
  "CodeRabbitRpcError",
  {
    message: TrimmedNonEmptyString,
    reason: CodeRabbitRpcErrorReason,
    cause: Schema.optional(Schema.Defect),
  },
) {}
