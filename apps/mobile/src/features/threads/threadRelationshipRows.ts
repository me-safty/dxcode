import type { ThreadRelationshipWalkRow } from "@t3tools/client-runtime/state/thread-relationships";
import type { ThreadId } from "@t3tools/contracts";

export function orderThreadRelationshipRows(
  rows: ReadonlyArray<ThreadRelationshipWalkRow>,
  mergeTargetThreadId: ThreadId | null,
): ReadonlyArray<ThreadRelationshipWalkRow> {
  return Array.from(rows).sort(
    (left, right) =>
      Number(right.threadId === mergeTargetThreadId) -
      Number(left.threadId === mergeTargetThreadId),
  );
}
