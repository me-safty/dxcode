import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

export interface OwnedSubagentTreeNode {
  readonly thread: OrchestrationV2ThreadShell;
  readonly depth: number;
}

/**
 * Returns the canonical descendants owned by `rootThreadId`.
 *
 * Fork and context-transfer relationships are intentionally not ownership
 * edges. A visited set also makes corrupted lineage cycles safe to inspect.
 */
export function ownedSubagentDescendants(
  rootThreadId: ThreadId,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): ReadonlyArray<OwnedSubagentTreeNode> {
  const childrenByParent = new Map<ThreadId, Array<OrchestrationV2ThreadShell>>();
  for (const thread of threads) {
    const parentThreadId = thread.lineage.parentThreadId;
    if (thread.lineage.relationshipToParent !== "subagent" || parentThreadId === null) {
      continue;
    }
    const children = childrenByParent.get(parentThreadId) ?? [];
    children.push(thread);
    childrenByParent.set(parentThreadId, children);
  }

  const visited = new Set<ThreadId>([rootThreadId]);
  const queue: Array<{ readonly threadId: ThreadId; readonly depth: number }> = [
    { threadId: rootThreadId, depth: 0 },
  ];
  const descendants: Array<OwnedSubagentTreeNode> = [];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const children = childrenByParent.get(current.threadId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const depth = current.depth + 1;
      descendants.push({ thread: child, depth });
      queue.push({ threadId: child.id, depth });
    }
  }
  return descendants;
}
