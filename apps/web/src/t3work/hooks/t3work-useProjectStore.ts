import { useState, useCallback } from "react";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type { ProjectShellProject } from "@t3tools/project-context";
import type {
  ProjectSortOrder,
  ThreadSortOrder,
  ViewState,
  ProjectThread,
} from "~/t3work/t3work-types";
import { MOCK_THREADS, MOCK_TICKETS } from "~/t3work/data/t3work-mockThreads";

let projectIdCounter = 0;
let threadIdCounter = 0;

function generateProjectId(): string {
  projectIdCounter += 1;
  return `proj-${projectIdCounter}`;
}

function generateThreadId(): string {
  threadIdCounter += 1;
  return `thread-${Date.now()}-${threadIdCounter}`;
}

const STORAGE_KEY = "t3work:projects";

function loadProjects(): ProjectShellProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return dedupeProjects(JSON.parse(raw) as ProjectShellProject[]);
  } catch {
    return [];
  }
}

function saveProjects(projects: ProjectShellProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function projectSourceKey(project: ProjectShellProject): string {
  return [
    project.source.provider,
    project.source.accountId ?? "",
    project.source.externalProjectId ?? project.id,
  ].join(":");
}

function dedupeProjects(projects: ProjectShellProject[]): ProjectShellProject[] {
  const bySourceKey = new Map<string, ProjectShellProject>();
  for (const project of projects) {
    bySourceKey.set(projectSourceKey(project), project);
  }
  return [...bySourceKey.values()];
}

export function useProjectStore() {
  const [projects, setProjects] = useState<ProjectShellProject[]>(loadProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => loadProjects()[0]?.id ?? null,
  );
  const [view, setView] = useState<ViewState | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(loadProjects().map((p) => p.id)),
  );
  const [threads, setThreads] = useState<ProjectThread[]>(MOCK_THREADS);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>("updated_at");
  const [threadSortOrder, setThreadSortOrder] = useState<ThreadSortOrder>("updated_at");
  const [threadPreviewCount, setThreadPreviewCount] = useState(5);

  const getThreadsForProject = useCallback(
    (projectId: string) => {
      return threads.filter((t) => t.projectId === projectId);
    },
    [threads],
  );

  const getTicketsForProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return [];
      const extId = project.source.externalProjectId;
      return MOCK_TICKETS.filter((t) => {
        if (extId === "jira-proj-einb") return t.projectId === "proj-einb";
        if (extId === "jira-proj-checkout") return t.projectId === "proj-ac";
        if (extId === "jira-proj-support") return t.projectId === "proj-csp";
        return false;
      });
    },
    [projects],
  );

  const addProject = useCallback((project: ProjectShellProject) => {
    setProjects((prev) => {
      const existingIndex = prev.findIndex(
        (candidate) => projectSourceKey(candidate) === projectSourceKey(project),
      );
      const next =
        existingIndex >= 0
          ? prev.map((candidate, index) => (index === existingIndex ? project : candidate))
          : [...prev, project];
      saveProjects(next);
      return next;
    });
    setSelectedProjectId(project.id);
    setExpandedProjectIds((prev) => new Set(prev).add(project.id));
    setView({ type: "dashboard", projectId: project.id });
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveProjects(next);
      return next;
    });
    setThreads((prev) => prev.filter((t) => t.projectId !== id));
    setSelectedProjectId((prev) => (prev === id ? null : prev));
    setView((prev) => (prev && prev.projectId === id ? null : prev));
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const renameProject = useCallback((id: string, newTitle: string) => {
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, title: newTitle } : p));
      saveProjects(next);
      return next;
    });
  }, []);

  const toggleProjectExpanded = useCallback((id: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    setView({ type: "dashboard", projectId: id });
  }, []);

  const selectTicket = useCallback((projectId: string, ticketId: string) => {
    setSelectedProjectId(projectId);
    setView({ type: "ticket", projectId, ticketId });
  }, []);

  const selectThread = useCallback((projectId: string, threadId: string) => {
    setSelectedProjectId(projectId);
    setView({ type: "thread", projectId, threadId });
  }, []);

  const createThread = useCallback(
    (
      projectId: string,
      options?: {
        title?: string;
        ticketId?: string;
        kickoffMessage?: string;
        kickoffPending?: boolean;
        kickoffModelSelection?: ModelSelection;
        kickoffRuntimeMode?: RuntimeMode;
        kickoffInteractionMode?: ProviderInteractionMode;
      },
    ) => {
      const now = new Date().toISOString();
      const newThread: ProjectThread = {
        id: generateThreadId(),
        projectId,
        ...(options?.ticketId ? { ticketId: options.ticketId } : {}),
        title: options?.title ?? "New thread",
        status: "idle",
        lastMessageAt: now,
        messageCount: 0,
        createdAt: now,
        ...(options?.kickoffMessage ? { kickoffMessage: options.kickoffMessage } : {}),
        ...(options?.kickoffPending !== undefined
          ? { kickoffPending: options.kickoffPending }
          : {}),
        ...(options?.kickoffModelSelection
          ? { kickoffModelSelection: options.kickoffModelSelection }
          : {}),
        ...(options?.kickoffRuntimeMode ? { kickoffRuntimeMode: options.kickoffRuntimeMode } : {}),
        ...(options?.kickoffInteractionMode
          ? { kickoffInteractionMode: options.kickoffInteractionMode }
          : {}),
      };
      setThreads((prev) => [...prev, newThread]);
      setSelectedProjectId(projectId);
      setExpandedProjectIds((prev) => new Set(prev).add(projectId));
      setView({ type: "thread", projectId, threadId: newThread.id });
      return newThread;
    },
    [],
  );

  const createThreadForTicket = useCallback(
    (input: {
      projectId: string;
      ticketId: string;
      ticketDisplayId: string;
      kickoffMessage: string;
      kickoffModelSelection: ModelSelection;
      kickoffRuntimeMode: RuntimeMode;
      kickoffInteractionMode: ProviderInteractionMode;
    }) => {
      const matching = threads.filter(
        (thread) => thread.projectId === input.projectId && thread.ticketId === input.ticketId,
      );
      const sequence = matching.length + 1;
      return createThread(input.projectId, {
        ticketId: input.ticketId,
        title: `${input.ticketDisplayId} kickoff ${sequence}`,
        kickoffMessage: input.kickoffMessage,
        kickoffPending: true,
        kickoffModelSelection: input.kickoffModelSelection,
        kickoffRuntimeMode: input.kickoffRuntimeMode,
        kickoffInteractionMode: input.kickoffInteractionMode,
      });
    },
    [createThread, threads],
  );

  const markThreadKickoffConsumed = useCallback((threadId: string) => {
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId ? { ...thread, kickoffPending: false } : thread,
      ),
    );
  }, []);

  const deleteThread = useCallback((threadId: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setView((prev) => (prev && prev.type === "thread" && prev.threadId === threadId ? null : prev));
  }, []);

  const renameThread = useCallback((threadId: string, newTitle: string) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t)));
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return {
    projects,
    selectedProject,
    selectedProjectId,
    view,
    expandedProjectIds,
    threads,
    projectSortOrder,
    threadSortOrder,
    threadPreviewCount,
    getThreadsForProject,
    getTicketsForProject,
    addProject,
    deleteProject,
    renameProject,
    toggleProjectExpanded,
    selectProject,
    selectTicket,
    selectThread,
    createThread,
    createThreadForTicket,
    markThreadKickoffConsumed,
    deleteThread,
    renameThread,
    setProjectSortOrder,
    setThreadSortOrder,
    setThreadPreviewCount,
    setView,
  };
}

export { generateProjectId };
