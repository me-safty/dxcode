import { useCallback } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { Project, Thread } from "~/types";
import type { ProjectThread } from "~/t3work/t3work-types";

import { getMockTicketsForProject } from "./t3work-projectStoreUtils";
import {
  mapLiveThreadToProjectThread,
  mergeProjectThreads,
  remapProjectThreadToStoredProject,
  resolveCanonicalProjectId,
  resolveStoredProjectId,
} from "./t3work-threadBridge";

export function useProjectStoreQueries(input: {
  projects: ProjectShellProject[];
  threads: ProjectThread[];
  liveProjects: ReadonlyArray<Project>;
  liveThreads: ReadonlyArray<Thread>;
}) {
  const { projects, threads, liveProjects, liveThreads } = input;

  const getThreadsForProject = useCallback(
    (projectId: string) => {
      const resolvedProjectId = resolveStoredProjectId(projectId, projects, liveProjects);
      const project =
        projects.find((candidate) => candidate.id === resolvedProjectId) ??
        projects.find((candidate) => candidate.id === projectId);
      const canonicalProjectId = resolveCanonicalProjectId(project, liveProjects) ?? projectId;
      const localThreads = threads
        .map((thread) => remapProjectThreadToStoredProject(thread, projects, liveProjects))
        .filter((thread) => thread.projectId === resolvedProjectId);
      const liveProjectThreads = liveThreads
        .filter((thread) => thread.projectId === canonicalProjectId)
        .map((thread) => mapLiveThreadToProjectThread(thread, resolvedProjectId));

      return mergeProjectThreads([...localThreads, ...liveProjectThreads]);
    },
    [liveProjects, liveThreads, projects, threads],
  );

  const getTicketsForProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      return project ? getMockTicketsForProject(project) : [];
    },
    [projects],
  );

  return {
    getThreadsForProject,
    getTicketsForProject,
  };
}
