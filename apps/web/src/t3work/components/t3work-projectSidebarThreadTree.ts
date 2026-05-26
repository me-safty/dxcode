import type { ProjectThread } from "~/t3work/t3work-types";

export function buildProjectSidebarThreadTree(threads: ReadonlyArray<ProjectThread>): {
  rootThreads: ProjectThread[];
  childThreadsByParentId: Map<string, ProjectThread[]>;
} {
  const threadIds = new Set(threads.map((thread) => thread.id));
  const rootThreads: ProjectThread[] = [];
  const childThreadsByParentId = new Map<string, ProjectThread[]>();

  for (const thread of threads) {
    if (
      thread.parentThreadId &&
      thread.parentThreadId !== thread.id &&
      threadIds.has(thread.parentThreadId)
    ) {
      const existingChildren = childThreadsByParentId.get(thread.parentThreadId) ?? [];
      existingChildren.push(thread);
      childThreadsByParentId.set(thread.parentThreadId, existingChildren);
      continue;
    }

    rootThreads.push(thread);
  }

  return {
    rootThreads,
    childThreadsByParentId,
  };
}
