import type { OrchestrationV2AppThread, ThreadId } from "@t3tools/contracts";

export interface OwnedSubagentLifecycleRepair {
  readonly type: "archive" | "delete";
  readonly parentThreadId: ThreadId;
  readonly childThreadIds: ReadonlyArray<ThreadId>;
}

/**
 * Finds direct ownership edges whose child lifecycle disagrees with its
 * parent. Repairing the parent recursively fixes the complete affected branch;
 * grouping direct children keeps the resulting command id stable and makes a
 * later, newly-created orphan produce a distinct repair command.
 */
export function planOwnedSubagentLifecycleRepairs(
  threads: ReadonlyArray<OrchestrationV2AppThread>,
): ReadonlyArray<OwnedSubagentLifecycleRepair> {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread] as const));
  const repairsByKey = new Map<string, OwnedSubagentLifecycleRepair>();

  for (const child of threads) {
    const parentThreadId = child.lineage.parentThreadId;
    if (
      child.deletedAt !== null ||
      child.lineage.relationshipToParent !== "subagent" ||
      parentThreadId === null
    ) {
      continue;
    }
    const parent = threadsById.get(parentThreadId);
    if (parent === undefined) continue;

    const type =
      parent.deletedAt !== null
        ? "delete"
        : parent.archivedAt !== null && child.archivedAt === null
          ? "archive"
          : null;
    if (type === null) continue;

    const key = `${type}:${parentThreadId}`;
    const existing = repairsByKey.get(key);
    repairsByKey.set(key, {
      type,
      parentThreadId,
      childThreadIds: [...(existing?.childThreadIds ?? []), child.id],
    });
  }

  return Array.from(repairsByKey.values())
    .map((repair) => ({
      ...repair,
      childThreadIds: repair.childThreadIds.toSorted((left, right) => left.localeCompare(right)),
    }))
    .toSorted(
      (left, right) =>
        (left.type === right.type ? 0 : left.type === "delete" ? -1 : 1) ||
        left.parentThreadId.localeCompare(right.parentThreadId),
    );
}
