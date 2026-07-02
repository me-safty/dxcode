import type {
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";

function upsertById<T extends { readonly id: unknown }>(
  items: ReadonlyArray<T>,
  item: T,
): ReadonlyArray<T> {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((candidate, candidateIndex) => (candidateIndex === index ? item : candidate));
}

function retainRepositoryIdentity(
  previous: OrchestrationProjectShell | undefined,
  next: OrchestrationProjectShell,
): OrchestrationProjectShell {
  if (
    next.repositoryIdentity == null &&
    previous?.repositoryIdentity != null &&
    previous.workspaceRoot === next.workspaceRoot
  ) {
    return { ...next, repositoryIdentity: previous.repositoryIdentity };
  }
  return next;
}

/**
 * When a full shell snapshot reloads projects, keep any previously resolved
 * repositoryIdentity for the same project id + workspace root. Cold enrichment
 * snapshots and racey refreshes otherwise null out keys and split multi-env
 * sidebar groups until the next successful resolve.
 */
export function mergeShellSnapshotProjects(
  previous: OrchestrationV2ShellSnapshot | null | undefined,
  next: OrchestrationV2ShellSnapshot,
): OrchestrationV2ShellSnapshot {
  if (previous === null || previous === undefined || previous.projects.length === 0) {
    return next;
  }
  const previousById = new Map(previous.projects.map((project) => [project.id, project] as const));
  return {
    ...next,
    projects: next.projects.map((project) =>
      retainRepositoryIdentity(previousById.get(project.id), project),
    ),
  };
}

/** Applies one committed V2 shell delta while preserving active/archive exclusivity. */
export function applyShellStreamEvent(
  snapshot: OrchestrationV2ShellSnapshot,
  event: Exclude<OrchestrationV2ShellStreamItem, { readonly kind: "snapshot" }>,
): OrchestrationV2ShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project.updated": {
      // Enrichment is async. A project mutation can land with null
      // repositoryIdentity while an earlier snapshot already resolved it.
      // Keep the prior identity for the same workspace root so multi-env
      // grouping does not split until a full snapshot refresh arrives.
      const previous = snapshot.projects.find((project) => project.id === event.project.id);
      const project = retainRepositoryIdentity(previous, event.project);
      return {
        ...snapshot,
        projects: upsertById(snapshot.projects, project),
        snapshotSequence: event.sequence,
      };
    }
    case "project.removed":
      return {
        ...snapshot,
        projects: snapshot.projects.filter((project) => project.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread.updated": {
      const withoutThread = (threads: OrchestrationV2ShellSnapshot["threads"]) =>
        threads.filter((thread) => thread.id !== event.thread.id);
      return {
        ...snapshot,
        threads:
          event.location === "active"
            ? upsertById(withoutThread(snapshot.threads), event.thread)
            : withoutThread(snapshot.threads),
        archivedThreads:
          event.location === "archive"
            ? upsertById(withoutThread(snapshot.archivedThreads), event.thread)
            : withoutThread(snapshot.archivedThreads),
        snapshotSequence: event.sequence,
      };
    }
    case "thread.removed":
      return {
        ...snapshot,
        threads: snapshot.threads.filter((thread) => thread.id !== event.threadId),
        archivedThreads: snapshot.archivedThreads.filter((thread) => thread.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
