import type { ProjectThread } from "~/t3work/t3work-types";

export function findProjectThreadById(
  projectIds: ReadonlyArray<string>,
  getThreadsForProject: (projectId: string) => ReadonlyArray<ProjectThread>,
  threadId: string,
): ProjectThread | undefined {
  for (const projectId of projectIds) {
    const match = getThreadsForProject(projectId).find((thread) => thread.id === threadId);
    if (match) {
      return match;
    }
  }

  return undefined;
}
