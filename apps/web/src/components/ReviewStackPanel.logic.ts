import type { ReviewStackSnapshotMetadata, ReviewStackTarget, ThreadId } from "@t3tools/contracts";

export function isReviewStackSnapshotOutdated(input: {
  readonly snapshot: ReviewStackSnapshotMetadata | undefined;
  readonly currentSourceHash: string | null;
  readonly currentSourceHashUnverifiable: boolean;
}): boolean {
  if (input.snapshot === undefined) return false;
  return (
    input.currentSourceHashUnverifiable ||
    input.snapshot.isCurrent === false ||
    (input.currentSourceHash !== null && input.snapshot.sourceHash !== input.currentSourceHash)
  );
}

export function filterReviewStackHistory(
  history: ReadonlyArray<ReviewStackSnapshotMetadata>,
  input: {
    readonly threadId: ThreadId;
    readonly target: ReviewStackTarget;
    readonly ignoreWhitespace: boolean;
  },
): ReadonlyArray<ReviewStackSnapshotMetadata> {
  const target = JSON.stringify(input.target);
  return history.filter((item) => {
    if (item.threadId !== input.threadId) return false;
    try {
      const scope = JSON.parse(item.scopeKey) as {
        readonly target?: unknown;
        readonly ignoreWhitespace?: unknown;
      };
      return (
        JSON.stringify(scope.target) === target && scope.ignoreWhitespace === input.ignoreWhitespace
      );
    } catch {
      return false;
    }
  });
}
