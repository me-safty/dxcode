import { useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import { AtlassianIcon } from "~/t3work/components/brand/t3work-AtlassianLogos";
import { Button } from "~/t3work/components/ui/t3work-button";
import { SidebarTrigger } from "~/t3work/components/ui/t3work-sidebar";
import { useT3WorkActiveChatStore } from "~/t3work/t3work-activeChatStore";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { ConnectionStatusBadge } from "./t3work-AppStatusBits";

export function useHomeProjectChat(input: {
  projects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
}) {
  const { projects, getThreadsForProject } = input;

  const homeChatProject = projects[0] ?? null;
  const homeChatThreadId = useMemo(() => {
    if (!homeChatProject) {
      return null;
    }
    const existing = getThreadsForProject(homeChatProject.id).toSorted(
      (left, right) =>
        new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
    )[0];
    return existing?.id ?? `project-${homeChatProject.id}-chat`;
  }, [getThreadsForProject, homeChatProject]);

  return {
    homeChatProject,
    homeChatThreadId,
  };
}

export function useSyncActiveChatTarget(input: {
  view: ViewState | null;
  getThreadsForProject: (projectId: string) => ProjectThread[];
  homeChatProject: ProjectShellProject | null;
  homeChatThreadId: string | null;
}) {
  const { view, getThreadsForProject, homeChatProject, homeChatThreadId } = input;
  const setActiveChatTarget = useT3WorkActiveChatStore((state) => state.setTarget);

  useEffect(() => {
    if (!view) {
      if (homeChatProject && homeChatThreadId) {
        setActiveChatTarget({
          type: "thread",
          projectId: homeChatProject.id,
          threadId: homeChatThreadId,
        });
        return;
      }
      setActiveChatTarget(null);
      return;
    }

    if (view.type === "thread") {
      setActiveChatTarget({
        type: "thread",
        projectId: view.projectId,
        threadId: view.threadId,
      });
      return;
    }

    if (view.type === "ticket") {
      setActiveChatTarget({
        type: "kickoff",
        projectId: view.projectId,
        ticketId: view.ticketId,
      });
      return;
    }

    const projectThread = getThreadsForProject(view.projectId).toSorted(
      (left, right) =>
        new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
    )[0];
    setActiveChatTarget({
      type: "thread",
      projectId: view.projectId,
      threadId: projectThread?.id ?? `project-${view.projectId}-chat`,
    });
  }, [getThreadsForProject, homeChatProject, homeChatThreadId, setActiveChatTarget, view]);
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

export function ProjectBrowserEmptyWithChat({
  onCreate,
  project,
  chatThreadId,
}: {
  onCreate: () => void;
  project: ProjectShellProject | null;
  chatThreadId: string | null;
}) {
  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,38%)]">
      <ProjectBrowserEmpty onCreate={onCreate} />
      <aside className="flex min-h-0 h-full border-l border-border/70">
        {project && chatThreadId ? (
          <div className="flex min-h-0 flex-1">
            <ThreadChatView
              threadId={chatThreadId}
              projectId={project.id}
              projectTitle={project.title}
              {...(project.workspace?.rootPath
                ? { projectWorkspaceRoot: project.workspace.rootPath }
                : {})}
              title={`${project.title} chat`}
            />
          </div>
        ) : (
          <div className="flex min-h-0 h-full flex-1 items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
            Create a project to start chatting.
          </div>
        )}
      </aside>
    </div>
  );
}
