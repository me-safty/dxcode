import type { ProjectShellProject } from "@t3tools/project-context";
import { useBackendState } from "~/t3work/backend/t3work-index";
import type {
  ProjectKickoffThreadInput,
  TicketKickoffThreadInput,
} from "~/t3work/t3work-kickoffTypes";
import type { ProjectDashboardMode } from "~/t3work/t3work-projectDashboardModeState";
import {
  readActiveThreadIdFromView,
  type ProjectThread,
  type ViewState,
} from "~/t3work/t3work-types";
import { AppDashboardPane } from "~/t3work/t3work-AppDashboardPane";
import { AppThreadPane } from "~/t3work/t3work-AppThreadPane";
import { AppMainContentHomeEmptyState } from "~/t3work/t3work-AppMainContentHomeEmptyState";
import { isHomeProjectId } from "~/t3work/t3work-homeProject";
import { useThreadResolutionDebug } from "~/t3work/t3work-useThreadResolutionDebug";
import { useHomeProjectChat, useSyncActiveChatTarget } from "./t3work-AppMainContentShell";

type MainContentProps = {
  view: ViewState | null;
  activeDashboardMode: ProjectDashboardMode;
  selectedProjectId: string | null;
  projects: ProjectShellProject[];
  allProjects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onOpenThread: (projectId: string, threadId: string) => void;
  onOpenFullThread: (projectId: string, threadId: string) => void;
  onKickoffProjectThread: (input: ProjectKickoffThreadInput) => void;
  onKickoffTicketThread: (input: TicketKickoffThreadInput) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onBackToDashboard: (projectId: string) => void;
  onCreate: () => void;
  onInlineProjectCreated: (project: ProjectShellProject) => void;
  renderDashboard: (project: ProjectShellProject) => React.ReactNode;
  renderTicketDetail: (
    project: ProjectShellProject,
    ticketId: string,
    activeThreadId?: string,
  ) => React.ReactNode;
};

export function AppMainContent({
  view,
  activeDashboardMode,
  selectedProjectId,
  projects,
  allProjects,
  getThreadsForProject,
  onOpenThread,
  onOpenFullThread,
  onKickoffProjectThread,
  onBackToDashboard,
  onCreate,
  onInlineProjectCreated,
  renderDashboard,
  renderTicketDetail,
  onThreadKickoffConsumed,
}: MainContentProps) {
  const backendState = useBackendState();
  const { homeChatProject, homeChatThreadId } = useHomeProjectChat({
    projects,
    getThreadsForProject,
  });
  const hasAnyProjects = allProjects.length > 0;
  const isFirstRunSetup = !view && !hasAnyProjects;
  const homeProject =
    !view && hasAnyProjects
      ? (allProjects.find((candidate) => candidate.id === selectedProjectId) ??
        allProjects[0] ??
        null)
      : null;

  const renderHomeBrowserEmpty = () => (
    <AppMainContentHomeEmptyState
      onCreate={onCreate}
      onInlineProjectCreated={onInlineProjectCreated}
      isFirstRunSetup={isFirstRunSetup}
      showAside={projects.length > 0}
      homeChatProject={homeChatProject}
      homeChatProjectThreads={homeChatProject ? getThreadsForProject(homeChatProject.id) : []}
      providers={backendState.providers}
      isConnected={backendState.connectionStatus === "connected"}
      onOpenHomeThread={(threadId) => {
        if (homeChatProject) onOpenThread(homeChatProject.id, threadId);
      }}
      onKickoffHomeThread={(
        kickoffMessage,
        kickoffModelSelection,
        kickoffRuntimeMode,
        kickoffInteractionMode,
        selectedToolIds,
        kickoffContextAttachments,
      ) => {
        if (!homeChatProject) return;
        onKickoffProjectThread({
          projectId: homeChatProject.id,
          kickoffMessage,
          kickoffModelSelection,
          kickoffRuntimeMode,
          kickoffInteractionMode,
          selectedToolIds,
          kickoffContextAttachments,
        });
      }}
    />
  );
  useSyncActiveChatTarget({
    view,
    getThreadsForProject,
    homeChatProject,
    homeChatThreadId,
  });

  const activeThreadId = readActiveThreadIdFromView(view);
  const threadProject =
    activeThreadId && view
      ? (allProjects.find((candidate) => candidate.id === view.projectId) ??
        (view.type === "thread" && isHomeProjectId(view.projectId) ? homeChatProject : null))
      : null;
  const threadProjectThreads = threadProject ? getThreadsForProject(threadProject.id) : [];
  const resolvedThread = activeThreadId
    ? (threadProjectThreads.find((candidate) => candidate.id === activeThreadId) ?? null)
    : null;

  useThreadResolutionDebug({
    routeProjectId: view?.projectId ?? null,
    routeThreadId: activeThreadId,
    resolvedProjectId: threadProject?.id ?? null,
    resolvedProjectWorkspaceRoot: threadProject?.workspace?.rootPath ?? null,
    projectThreadCount: threadProjectThreads.length,
    resolvedThreadId: resolvedThread?.id ?? null,
    resolvedThreadProjectId: resolvedThread?.projectId ?? null,
    resolvedThreadStatus: resolvedThread?.status ?? null,
    kickoffPending: resolvedThread?.kickoffPending ?? null,
  });

  if (!view) {
    if (homeProject) {
      return (
        <AppDashboardPane
          activeDashboardMode={activeDashboardMode}
          project={homeProject}
          projectThreads={getThreadsForProject(homeProject.id)}
          activeThread={null}
          activeThreadId={null}
          providers={backendState.providers}
          isConnected={backendState.connectionStatus === "connected"}
          onOpenThread={onOpenThread}
          onOpenFullThread={onOpenFullThread}
          onThreadKickoffConsumed={onThreadKickoffConsumed}
          onKickoffProjectThread={onKickoffProjectThread}
          renderDashboard={renderDashboard}
        />
      );
    }

    return renderHomeBrowserEmpty();
  }

  if (view.type === "thread") {
    return (
      <AppThreadPane
        view={view}
        threadProject={threadProject}
        resolvedThread={resolvedThread}
        onOpenThread={onOpenThread}
        onThreadKickoffConsumed={onThreadKickoffConsumed}
        onBackToDashboard={onBackToDashboard}
      />
    );
  }

  const project = projects.find((candidate) => candidate.id === view.projectId);
  if (!project) {
    return renderHomeBrowserEmpty();
  }

  if (view.type === "dashboard") {
    return (
      <AppDashboardPane
        activeDashboardMode={activeDashboardMode}
        project={project}
        projectThreads={getThreadsForProject(project.id)}
        activeThread={resolvedThread}
        activeThreadId={view.embeddedThreadId ?? null}
        providers={backendState.providers}
        isConnected={backendState.connectionStatus === "connected"}
        onOpenThread={onOpenThread}
        onOpenFullThread={onOpenFullThread}
        onThreadKickoffConsumed={onThreadKickoffConsumed}
        onKickoffProjectThread={onKickoffProjectThread}
        renderDashboard={renderDashboard}
      />
    );
  }

  if (view.type === "ticket") {
    return <>{renderTicketDetail(project, view.ticketId, view.embeddedThreadId)}</>;
  }

  return renderHomeBrowserEmpty();
}
