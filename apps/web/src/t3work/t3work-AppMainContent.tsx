import type { ProjectShellProject } from "@t3tools/project-context";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import { useBackendState } from "~/t3work/backend/t3work-index";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { ProjectDashboardKickoffAside } from "~/t3work/t3work-ProjectDashboardKickoffAside";
import {
  ProjectBrowserEmptyWithChat,
  useHomeProjectChat,
  useSyncActiveChatTarget,
} from "./t3work-AppMainContentShell";

type MainContentProps = {
  view: ViewState | null;
  projects: ProjectShellProject[];
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
  useSyncActiveChatTarget({
    view,
    getThreadsForProject,
    homeChatProject,
    homeChatThreadId,
  });

  if (!view) {
    return (
      <ProjectBrowserEmptyWithChat
        onCreate={onCreate}
        project={homeChatProject}
        chatThreadId={homeChatThreadId}
      />
    );
  }

  if (view.type === "thread") {
    const project = projects.find((candidate) => candidate.id === view.projectId) ?? null;
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
    return (
      <ProjectBrowserEmptyWithChat
        onCreate={onCreate}
        project={homeChatProject}
        chatThreadId={homeChatThreadId}
      />
    );
  }

  if (view.type === "dashboard") {
    return (
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,36%)]">
        <div className="min-h-0">{renderDashboard(project)}</div>
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
      </div>
    );
  }

  if (view.type === "ticket") {
    return <>{renderTicketDetail(project, view.ticketId)}</>;
  }

  return (
    <ProjectBrowserEmptyWithChat
      onCreate={onCreate}
      project={homeChatProject}
      chatThreadId={homeChatThreadId}
    />
  );
}
