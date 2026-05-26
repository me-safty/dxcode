import { useState, useCallback, useEffect, useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import type { ViewState, ProjectThread } from "~/t3work/t3work-types";
import { useProjectStoreActions } from "./t3work-useProjectStoreActions";
import { useProjectStoreQueries } from "./t3work-useProjectStoreQueries";
import { useProjectThreadActions } from "./t3work-useProjectThreadActions";
import { useHydrateStoredProjects } from "./t3work-useHydrateStoredProjects";
import { useHydrateStoredThreads } from "./t3work-useHydrateStoredThreads";
import {
  generateProjectId,
  deriveLooseWorkspaceProjects,
  loadStoredProjects,
} from "./t3work-projectStoreUtils";
import { persistStoredThreads } from "./t3work-projectThreadPersistence";
import { remapProjectThreadToStoredProject, resolveStoredProjectId } from "./t3work-threadBridge";

export function useProjectStore() {
  const [storedProjects, setStoredProjects] = useState<ProjectShellProject[]>(loadStoredProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => loadStoredProjects()[0]?.id ?? null,
  );
  const [view, setView] = useState<ViewState | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(loadStoredProjects().map((p) => p.id)),
  );
  const [threads, setThreads] = useState<ProjectThread[]>([]);
  const [threadsHydrated, setThreadsHydrated] = useState(false);
  const liveProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const liveThreads = useStore(useShallow(selectThreadsAcrossEnvironments));
  useHydrateStoredProjects({
    setStoredProjects,
    setSelectedProjectId,
    setExpandedProjectIds,
  });
  useHydrateStoredThreads({ setThreads, setThreadsHydrated });

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    persistStoredThreads(threads);
  }, [threads, threadsHydrated]);

  useEffect(() => {
    setThreads((currentThreads) => {
      let changed = false;
      const nextThreads = currentThreads.map((thread) => {
        const normalizedThread = remapProjectThreadToStoredProject(
          thread,
          storedProjects,
          liveProjects,
        );
        if (normalizedThread !== thread) {
          changed = true;
        }
        return normalizedThread;
      });
      return changed ? nextThreads : currentThreads;
    });
  }, [liveProjects, storedProjects]);

  const looseWorkspaceProjects = useMemo(
    () => deriveLooseWorkspaceProjects(storedProjects, liveProjects),
    [liveProjects, storedProjects],
  );
  const resolveProjectId = useCallback(
    (projectId: string) => resolveStoredProjectId(projectId, storedProjects, liveProjects),
    [liveProjects, storedProjects],
  );
  const visibleLooseWorkspaceProjects = useMemo(
    () => looseWorkspaceProjects.filter((project) => resolveProjectId(project.id) === project.id),
    [looseWorkspaceProjects, resolveProjectId],
  );
  const allProjects = useMemo(
    () => [...storedProjects, ...looseWorkspaceProjects],
    [looseWorkspaceProjects, storedProjects],
  );

  const { getThreadsForProject, getTicketsForProject } = useProjectStoreQueries({
    projects: allProjects,
    threads,
    liveProjects,
    liveThreads,
  });
  const {
    addProject,
    deleteProject,
    renameProject,
    updateProject,
    toggleProjectExpanded,
    selectProject,
    selectTicket,
    selectThread,
    selectStandaloneThread,
  } = useProjectStoreActions({
    allProjects,
    getThreadsForProject,
    setExpandedProjectIds,
    setSelectedProjectId,
    setStoredProjects,
    setThreads,
    setView,
  });

  const {
    createThread,
    createThreadForTicket,
    markThreadKickoffConsumed,
    deleteThread,
    renameThread,
    updateThreadDisplayMode,
  } = useProjectThreadActions({
    threads,
    setThreads,
    setSelectedProjectId,
    setExpandedProjectIds,
    setView,
  });

  const selectedProject = allProjects.find((project) => project.id === selectedProjectId) ?? null;

  return {
    projects: storedProjects,
    looseWorkspaceProjects: visibleLooseWorkspaceProjects,
    allProjects,
    selectedProject,
    selectedProjectId,
    view,
    expandedProjectIds,
    threads,
    getThreadsForProject,
    getTicketsForProject,
    addProject,
    deleteProject,
    renameProject,
    updateProject,
    toggleProjectExpanded,
    selectProject,
    selectTicket,
    selectThread,
    selectStandaloneThread,
    createThread,
    createThreadForTicket,
    markThreadKickoffConsumed,
    deleteThread,
    renameThread,
    updateThreadDisplayMode,
    resolveProjectId,
    setView,
  };
}

export { generateProjectId };
