import * as Schema from "effect/Schema";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const ReviewChangeArea = Schema.Literals(["staged", "unstaged"]);
export type ReviewChangeArea = typeof ReviewChangeArea.Type;

export const ReviewChangeKind = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
]);
export type ReviewChangeKind = typeof ReviewChangeKind.Type;

export const ReviewChangedFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
  kind: ReviewChangeKind,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type ReviewChangedFile = typeof ReviewChangedFile.Type;

export const ReviewWorkingTreeManifest = Schema.Struct({
  staged: Schema.Array(ReviewChangedFile),
  unstaged: Schema.Array(ReviewChangedFile),
  truncated: Schema.Boolean,
});
export type ReviewWorkingTreeManifest = typeof ReviewWorkingTreeManifest.Type;

export const ReviewCommitSha = TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{40}$/i));
export type ReviewCommitSha = typeof ReviewCommitSha.Type;

export const ReviewDiffSelection = Schema.Union([
  Schema.TaggedStruct("all", {}),
  Schema.TaggedStruct("file", {
    area: ReviewChangeArea,
    path: TrimmedNonEmptyString,
  }),
  Schema.TaggedStruct("commit", {
    sha: ReviewCommitSha,
  }),
]);
export type ReviewDiffSelection = typeof ReviewDiffSelection.Type;

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: ThreadId,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  selection: Schema.optionalKey(ReviewDiffSelection),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewCommit = Schema.Struct({
  sha: ReviewCommitSha,
  title: TrimmedNonEmptyString,
  committedAt: TrimmedNonEmptyString,
});
export type ReviewCommit = typeof ReviewCommit.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
  commits: Schema.Array(ReviewCommit),
  workingTree: ReviewWorkingTreeManifest,
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const ReviewStagePathsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: ThreadId,
  paths: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
});
export type ReviewStagePathsInput = typeof ReviewStagePathsInput.Type;

export const ReviewStagePathsResult = Schema.Struct({
  stagedPaths: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewStagePathsResult = typeof ReviewStagePathsResult.Type;

export const ReviewStagePathsError = ReviewDiffPreviewError;
export type ReviewStagePathsError = typeof ReviewStagePathsError.Type;

export const ReviewUnstageChange = Schema.Struct({
  path: TrimmedNonEmptyString,
  previousPath: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReviewUnstageChange = typeof ReviewUnstageChange.Type;

export const ReviewUnstagePathsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: ThreadId,
  changes: Schema.Array(ReviewUnstageChange).check(Schema.isMinLength(1)),
});
export type ReviewUnstagePathsInput = typeof ReviewUnstagePathsInput.Type;

export const ReviewUnstagePathsResult = Schema.Struct({
  unstagedPaths: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewUnstagePathsResult = typeof ReviewUnstagePathsResult.Type;

export const ReviewUnstagePathsError = ReviewDiffPreviewError;
export type ReviewUnstagePathsError = typeof ReviewUnstagePathsError.Type;

export const ReviewDiscardChange = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ReviewChangeKind,
});
export type ReviewDiscardChange = typeof ReviewDiscardChange.Type;

export const ReviewDiscardChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  threadId: ThreadId,
  changes: Schema.Array(ReviewDiscardChange).check(Schema.isMinLength(1)),
});
export type ReviewDiscardChangesInput = typeof ReviewDiscardChangesInput.Type;

export const ReviewDiscardChangesResult = Schema.Struct({
  discardedPaths: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewDiscardChangesResult = typeof ReviewDiscardChangesResult.Type;

export const ReviewDiscardChangesError = ReviewDiffPreviewError;
export type ReviewDiscardChangesError = typeof ReviewDiscardChangesError.Type;
