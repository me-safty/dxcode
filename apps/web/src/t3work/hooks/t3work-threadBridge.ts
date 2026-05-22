import type { ProjectShellProject } from "@t3tools/project-context";

import type { Project, Thread } from "~/types";
import type { ProjectThread } from "~/t3work/t3work-types";

export function normalizeWorkspaceRootPath(
  workspaceRoot: string | null | undefined,
): string | null {
  if (typeof workspaceRoot !== "string") {
    return null;
  }

  const trimmed = workspaceRoot.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalizedSeparators = trimmed.replaceAll("\\", "/");
  const normalizedDrive = normalizedSeparators.replace(
    /^([a-z]):(?=\/|$)/,
    (_, drive: string) => `${drive.toUpperCase()}:`,
  );

  if (normalizedDrive === "/" || /^[A-Z]:\/$/.test(normalizedDrive)) {
    return normalizedDrive;
  }

  const withoutTrailingSlash = normalizedDrive.replace(/\/+$/, "");
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : normalizedDrive;
}

export function resolveCanonicalProjectIdForWorkspaceRoot(
  workspaceRoot: string | undefined,
  fallbackProjectId: string,
  liveProjects: ReadonlyArray<Project>,
): string {
  const normalizedWorkspaceRoot = normalizeWorkspaceRootPath(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return fallbackProjectId;
  }

  return (
    liveProjects.find(
      (candidate) => normalizeWorkspaceRootPath(candidate.cwd) === normalizedWorkspaceRoot,
    )?.id ?? fallbackProjectId
  );
}

export function resolveCanonicalProjectId(
  project: ProjectShellProject | null | undefined,
  liveProjects: ReadonlyArray<Project>,
): string | null {
  const workspaceRoot = normalizeWorkspaceRootPath(project?.workspace?.rootPath);
  if (!workspaceRoot) {
    return null;
  }

  return (
    liveProjects.find((candidate) => normalizeWorkspaceRootPath(candidate.cwd) === workspaceRoot)
      ?.id ?? null
  );
}

export function mapLiveThreadToProjectThread(thread: Thread): ProjectThread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    messageCount: thread.messages.length,
    lastMessageAt: thread.latestTurn?.completedAt ?? thread.updatedAt ?? thread.createdAt,
    createdAt: thread.createdAt,
    status: thread.error
      ? "error"
      : thread.session?.status === "running" || thread.session?.status === "connecting"
        ? "running"
        : thread.session?.status === "error"
          ? "error"
          : thread.session?.status === "closed" || thread.archivedAt
            ? "completed"
            : "idle",
  };
}

export function mergeProjectThreads(threads: ReadonlyArray<ProjectThread>): ProjectThread[] {
  const byId = new Map<string, ProjectThread>();

  for (const thread of threads) {
    byId.set(thread.id, thread);
  }

  return [...byId.values()];
}
