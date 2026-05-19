import type { ProjectShellProject } from "@t3tools/project-context";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import { useBackendState } from "~/t3work/backend/t3work-index";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { ProjectDashboardKickoffAside } from "~/t3work/t3work-ProjectDashboardKickoffAside";
import { ResizableRightSidebarLayout } from "~/t3work/t3work-ResizableRightSidebarLayout";
import { isHomeProjectId } from "~/t3work/t3work-homeProject";
import {
  ProjectBrowserEmptyWithChat,
  useHomeProjectChat,
  useSyncActiveChatTarget,
} from "./t3work-AppMainContentShell";

type MainContentProps = {
  view: ViewState | null;
  projects: ProjectShellProject[];
  allProjects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onOpenThread: (projectId: string, threadId: string) => void;
  onKickoffProjectThread: (input: {
    projectId: string;
    kickoffMessage: string;
    kickoffModelSelection: ModelSelection;
    kickoffRuntimeMode: RuntimeMode;
    kickoffInteractionMode: ProviderInteractionMode;
  }) => void;
  onKickoffTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
    githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
    kickoffMessage: string;
    kickoffModelSelection: ModelSelection;
    kickoffRuntimeMode: RuntimeMode;
    kickoffInteractionMode: ProviderInteractionMode;
  }) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onBackToDashboard: (projectId: string) => void;
  onCreate: () => void;
  renderDashboard: (project: ProjectShellProject) => React.ReactNode;
  renderTicketDetail: (project: ProjectShellProject, ticketId: string) => React.ReactNode;
};

export function AppMainContent({
  view,
  projects,
  allProjects,
  getThreadsForProject,
  onOpenThread,
  onKickoffProjectThread,
  onBackToDashboard,
  onCreate,
  renderDashboard,
  renderTicketDetail,
  onThreadKickoffConsumed,
}: MainContentProps) {
  const backendState = useBackendState();
  const { homeChatProject, homeChatThreadId } = useHomeProjectChat({
    projects,
    getThreadsForProject,
  });
  const renderHomeBrowserEmpty = () => (
    <ProjectBrowserEmptyWithChat
      onCreate={onCreate}
      project={homeChatProject}
      projectThreads={homeChatProject ? getThreadsForProject(homeChatProject.id) : []}
      providers={backendState.providers}
      isConnected={backendState.connectionStatus === "connected"}
      onOpenThread={(threadId) => {
        if (homeChatProject) onOpenThread(homeChatProject.id, threadId);
      }}
      onKickoffThread={(
        kickoffMessage,
        kickoffModelSelection,
        kickoffRuntimeMode,
        kickoffInteractionMode,
      ) => {
        if (!homeChatProject) return;
        onKickoffProjectThread({
          projectId: homeChatProject.id,
          kickoffMessage,
          kickoffModelSelection,
          kickoffRuntimeMode,
          kickoffInteractionMode,
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

  if (!view) {
    return renderHomeBrowserEmpty();
  }

  if (view.type === "thread") {
    const project =
      allProjects.find((candidate) => candidate.id === view.projectId) ??
      (isHomeProjectId(view.projectId) ? homeChatProject : null);
    const thread = project
      ? (getThreadsForProject(project.id).find((candidate) => candidate.id === view.threadId) ??
        null)
      : null;

    return (
      <ThreadChatView
        threadId={view.threadId}
        projectId={view.projectId}
        projectTitle={project?.title ?? view.projectId}
        {...(project?.workspace?.rootPath
          ? { projectWorkspaceRoot: project.workspace.rootPath }
          : {})}
        title={thread?.title ?? "New thread"}
        {...(thread?.kickoffPending && thread.kickoffMessage
          ? { initialUserMessage: thread.kickoffMessage }
          : {})}
        {...(thread?.kickoffModelSelection
          ? { initialModelSelection: thread.kickoffModelSelection }
          : {})}
        {...(thread?.kickoffRuntimeMode ? { initialRuntimeMode: thread.kickoffRuntimeMode } : {})}
        {...(thread?.kickoffInteractionMode
          ? { initialInteractionMode: thread.kickoffInteractionMode }
          : {})}
        onInitialUserMessageSent={() => {
          if (thread) onThreadKickoffConsumed(thread.id);
        }}
        onBack={() => onBackToDashboard(view.projectId)}
      />
    );
  }

  const project = projects.find((candidate) => candidate.id === view.projectId);
  if (!project) {
    return renderHomeBrowserEmpty();
  }

  if (view.type === "dashboard") {
    return (
      <ResizableRightSidebarLayout
        storageKey="t3work_dashboard_right_sidebar"
        minAsideWidth={22 * 16}
        defaultAsideWidth={24 * 16}
        main={
          <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            {renderDashboard(project)}
          </div>
        }
        aside={
          <ProjectDashboardKickoffAside
            project={project}
            projectThreads={getThreadsForProject(project.id)}
            providers={backendState.providers}
            isConnected={backendState.connectionStatus === "connected"}
            onOpenThread={(threadId) => onOpenThread(project.id, threadId)}
            onKickoffThread={(
              kickoffMessage,
              kickoffModelSelection,
              kickoffRuntimeMode,
              kickoffInteractionMode,
            ) => {
              onKickoffProjectThread({
                projectId: project.id,
                kickoffMessage,
                kickoffModelSelection,
                kickoffRuntimeMode,
                kickoffInteractionMode,
              });
            }}
          />
        }
      />
    );
  }

  if (view.type === "ticket") {
    return <>{renderTicketDetail(project, view.ticketId)}</>;
  }

  return renderHomeBrowserEmpty();
}
