import { useCallback } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { Project, Thread } from "~/types";
import type { ProjectThread } from "~/t3work/t3work-types";

import { getMockTicketsForProject } from "./t3work-projectStoreUtils";
import {
  mapLiveThreadToProjectThread,
  mergeProjectThreads,
  resolveCanonicalProjectId,
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
      const project = projects.find((candidate) => candidate.id === projectId);
      const canonicalProjectId = resolveCanonicalProjectId(project, liveProjects) ?? projectId;
      const localThreads = threads.filter((thread) => thread.projectId === projectId);
      const liveProjectThreads = liveThreads
        .filter((thread) => thread.projectId === canonicalProjectId)
        .map(mapLiveThreadToProjectThread);

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
