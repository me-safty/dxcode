import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import type { Project, Thread } from "~/types";
import { useBackend } from "~/t3work/backend/t3work-index";
import type { T3workThreadPlacement } from "~/t3work/backend/t3work-types";
import { upsertProjectThreadLocalState } from "~/t3work/t3work-threadToolContext";
import type { ProjectThread } from "~/t3work/t3work-types";

import { mapLiveThreadToProjectThread, resolveStoredProjectId } from "./t3work-threadBridge";

export function readMissingThreadPlacementIds(input: {
  threads: ReadonlyArray<ProjectThread>;
  liveThreads: ReadonlyArray<Thread>;
}): string[] {
  const existingThreads = new Map(input.threads.map((thread) => [thread.id, thread] as const));

  return input.liveThreads.flatMap((thread) => {
    const existingThread = existingThreads.get(thread.id);
    return existingThread?.parentThreadId || existingThread?.ticketId ? [] : [thread.id];
  });
}

export function mergeFetchedThreadPlacements(input: {
  threads: ReadonlyArray<ProjectThread>;
  storedProjects: ReadonlyArray<ProjectShellProject>;
  liveProjects: ReadonlyArray<Project>;
  liveThreads: ReadonlyArray<Thread>;
  placements: ReadonlyArray<T3workThreadPlacement>;
}): ProjectThread[] {
  const liveThreadById = new Map(input.liveThreads.map((thread) => [thread.id, thread] as const));
  let nextThreads = input.threads as ProjectThread[];

  for (const placement of input.placements) {
    const liveThread = liveThreadById.get(placement.threadId);
    if (!liveThread) {
      continue;
    }

    const shadowThread = {
      ...mapLiveThreadToProjectThread(
        liveThread,
        resolveStoredProjectId(liveThread.projectId, input.storedProjects, input.liveProjects),
      ),
      ...(placement.parentThreadId ? { parentThreadId: placement.parentThreadId } : {}),
      ...(placement.ticketId ? { ticketId: placement.ticketId } : {}),
    } satisfies ProjectThread;

    if (!shadowThread.parentThreadId && !shadowThread.ticketId) {
      continue;
    }

    nextThreads = upsertProjectThreadLocalState(nextThreads, shadowThread);
  }

  return nextThreads;
}

export function useHydrateThreadPlacements(input: {
  threads: ReadonlyArray<ProjectThread>;
  setThreads: Dispatch<SetStateAction<ProjectThread[]>>;
  storedProjects: ReadonlyArray<ProjectShellProject>;
  liveProjects: ReadonlyArray<Project>;
  liveThreads: ReadonlyArray<Thread>;
}) {
  const backend = useBackend();
  const candidateThreadIds = useMemo(
    () => readMissingThreadPlacementIds(input),
    [input.liveThreads, input.threads],
  );
  const candidateThreadIdsKey = candidateThreadIds.join("\n");

  useEffect(() => {
    let cancelled = false;

    if (!backend || candidateThreadIds.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void backend
      .listThreadPlacements({ threadIds: candidateThreadIds })
      .then((placements) => {
        if (cancelled || placements.length === 0) {
          return;
        }

        input.setThreads((currentThreads) =>
          mergeFetchedThreadPlacements({
            threads: currentThreads,
            storedProjects: input.storedProjects,
            liveProjects: input.liveProjects,
            liveThreads: input.liveThreads,
            placements,
          }),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    backend,
    candidateThreadIds,
    candidateThreadIdsKey,
    input.liveProjects,
    input.liveThreads,
    input.setThreads,
    input.storedProjects,
  ]);
}
