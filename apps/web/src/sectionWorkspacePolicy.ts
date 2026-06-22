import type { ProjectKind } from "@t3tools/contracts";

export type ThreadWorkspaceSeed = {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly envMode?: "local" | "worktree";
};

export function isManagedSectionWorkspace(projectKind: ProjectKind | undefined): boolean {
  return projectKind === "section";
}

export function isThreadWorkspaceReady(input: {
  readonly hasProject: boolean;
  readonly hasServerThread: boolean;
  readonly projectKind: ProjectKind | undefined;
  readonly worktreePath: string | null;
}): boolean {
  if (!input.hasProject) {
    return false;
  }
  if (!isManagedSectionWorkspace(input.projectKind)) {
    return true;
  }
  return input.hasServerThread && input.worktreePath !== null;
}

export function normalizeNewThreadWorkspaceSeed(
  projectKind: ProjectKind | undefined,
  seed: ThreadWorkspaceSeed,
): ThreadWorkspaceSeed {
  if (!isManagedSectionWorkspace(projectKind)) {
    return seed;
  }

  return {
    branch: null,
    worktreePath: null,
    envMode: "local",
  };
}
