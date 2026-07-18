import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";
import { ReviewCommitSha } from "./review.ts";

export const ReviewStackSnapshotId = TrimmedNonEmptyString.pipe(
  Schema.brand("ReviewStackSnapshotId"),
);
export type ReviewStackSnapshotId = typeof ReviewStackSnapshotId.Type;

export const ReviewStackTarget = Schema.Union([
  Schema.TaggedStruct("branch", { baseRef: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("commit", { sha: ReviewCommitSha }),
  Schema.TaggedStruct("working-tree", {}),
  Schema.TaggedStruct("turn", {
    turnId: TurnId,
    fromTurnCount: NonNegativeInt,
    toTurnCount: NonNegativeInt,
  }),
]);
export type ReviewStackTarget = typeof ReviewStackTarget.Type;

export const ReviewStackRiskSeverity = Schema.Literals(["low", "medium", "high"]);
export type ReviewStackRiskSeverity = typeof ReviewStackRiskSeverity.Type;

export const ReviewStackRisk = Schema.Struct({
  severity: ReviewStackRiskSeverity,
  summary: TrimmedNonEmptyString,
  evidence: TrimmedNonEmptyString,
});
export type ReviewStackRisk = typeof ReviewStackRisk.Type;

export const ReviewStackRange = Schema.Struct({
  anchorId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  risks: Schema.Array(ReviewStackRisk),
});
export type ReviewStackRange = typeof ReviewStackRange.Type;

export const ReviewStackLayer = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  ranges: Schema.Array(ReviewStackRange),
  diagram: Schema.NullOr(
    Schema.Struct({
      title: TrimmedNonEmptyString,
      text: TrimmedNonEmptyString,
    }),
  ),
});
export type ReviewStackLayer = typeof ReviewStackLayer.Type;

export const ReviewStackDocument = Schema.Struct({
  summary: TrimmedNonEmptyString,
  layers: Schema.Array(ReviewStackLayer),
});
export type ReviewStackDocument = typeof ReviewStackDocument.Type;

export const ReviewStackAnchor = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  kind: Schema.Literals(["hunk", "rename", "binary", "metadata"]),
  oldStart: Schema.NullOr(NonNegativeInt),
  oldLines: Schema.NullOr(NonNegativeInt),
  newStart: Schema.NullOr(NonNegativeInt),
  newLines: Schema.NullOr(NonNegativeInt),
  patch: Schema.String,
});
export type ReviewStackAnchor = typeof ReviewStackAnchor.Type;

export const ReviewStackStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type ReviewStackStatus = typeof ReviewStackStatus.Type;

export const ReviewStackStage = Schema.Literals([
  "queued",
  "analyzing",
  "validating",
  "saving",
  "completed",
  "failed",
  "cancelled",
]);
export type ReviewStackStage = typeof ReviewStackStage.Type;

export const ReviewStackSnapshotMetadata = Schema.Struct({
  snapshotId: ReviewStackSnapshotId,
  threadId: ThreadId,
  target: ReviewStackTarget,
  scopeKey: TrimmedNonEmptyString,
  sourceHash: TrimmedNonEmptyString,
  sourceTruncated: Schema.Boolean,
  status: ReviewStackStatus,
  stage: ReviewStackStage,
  modelSelection: ModelSelection,
  errorMessage: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ReviewStackSnapshotMetadata = typeof ReviewStackSnapshotMetadata.Type;

export const ReviewStackSnapshot = Schema.Struct({
  metadata: ReviewStackSnapshotMetadata,
  sourceDiff: Schema.String,
  anchorCatalog: Schema.Array(ReviewStackAnchor),
  instructions: Schema.String,
  review: Schema.NullOr(ReviewStackDocument),
});
export type ReviewStackSnapshot = typeof ReviewStackSnapshot.Type;

const ReviewStackScopeInput = {
  threadId: ThreadId,
  target: ReviewStackTarget,
  ignoreWhitespace: Schema.Boolean,
} as const;

export const ReviewStackEnsureInput = Schema.Struct({
  ...ReviewStackScopeInput,
  force: Schema.optionalKey(Schema.Boolean),
});
export type ReviewStackEnsureInput = typeof ReviewStackEnsureInput.Type;

export const ReviewStackListSnapshotsInput = Schema.Struct(ReviewStackScopeInput);
export type ReviewStackListSnapshotsInput = typeof ReviewStackListSnapshotsInput.Type;

export const ReviewStackGetSnapshotInput = Schema.Struct({
  threadId: ThreadId,
  snapshotId: ReviewStackSnapshotId,
});
export type ReviewStackGetSnapshotInput = typeof ReviewStackGetSnapshotInput.Type;

export const ReviewStackCancelInput = ReviewStackGetSnapshotInput;
export type ReviewStackCancelInput = typeof ReviewStackCancelInput.Type;

export const ReviewStackEvent = Schema.Struct({
  snapshotId: ReviewStackSnapshotId,
  threadId: ThreadId,
  status: ReviewStackStatus,
  stage: ReviewStackStage,
  updatedAt: IsoDateTime,
});
export type ReviewStackEvent = typeof ReviewStackEvent.Type;

export class ReviewStackError extends Schema.TaggedErrorClass<ReviewStackError>()(
  "ReviewStackError",
  {
    operation: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}
