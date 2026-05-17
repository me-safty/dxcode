import { Plus } from "lucide-react";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { AtlassianIcon } from "~/t3work/components/brand/t3work-AtlassianLogos";
import { Button } from "~/t3work/components/ui/t3work-button";
import { SidebarTrigger } from "~/t3work/components/ui/t3work-sidebar";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { ConnectionStatusBadge } from "./t3work-AppStatusBits";

type MainContentProps = {
  view: ViewState | null;
  projects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onOpenThread: (projectId: string, threadId: string) => void;
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
  onBackToDashboard,
  onCreate,
  renderDashboard,
  renderTicketDetail,
  onThreadKickoffConsumed,
}: MainContentProps) {
  if (!view) {
    return <ProjectBrowserEmpty onCreate={onCreate} />;
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
    return <ProjectBrowserEmpty onCreate={onCreate} />;
  }

  if (view.type === "dashboard") {
    return <>{renderDashboard(project)}</>;
  }

  if (view.type === "ticket") {
    return <>{renderTicketDetail(project, view.ticketId)}</>;
  }

  return <ProjectBrowserEmpty onCreate={onCreate} />;
}

function ProjectBrowserEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <span className="text-sm font-medium text-muted-foreground/70">No active project</span>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionStatusBadge />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-xl rounded-lg border border-border/70 bg-card/30 p-8 shadow-sm/5">
          <div className="mb-5 flex size-12 items-center justify-center rounded-lg border bg-background">
            <AtlassianIcon className="size-7" />
          </div>
          <h2 className="text-xl font-semibold">Start from a Jira project</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose a Jira project to browse work items and run an agent with ticket context.
          </p>
          <Button className="mt-6 w-fit" onClick={onCreate}>
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>
    </div>
  );
}
