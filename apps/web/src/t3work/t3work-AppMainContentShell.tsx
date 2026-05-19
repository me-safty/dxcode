import { useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";

import { AtlassianIcon } from "~/t3work/components/brand/t3work-AtlassianLogos";
import { Button } from "~/t3work/components/ui/t3work-button";
import { SidebarTrigger } from "~/t3work/components/ui/t3work-sidebar";
import { useT3WorkActiveChatStore } from "~/t3work/t3work-activeChatStore";
import { createHomeProject } from "~/t3work/t3work-homeProject";
import { ProjectDashboardKickoffAside } from "~/t3work/t3work-ProjectDashboardKickoffAside";
import { ResizableRightSidebarLayout } from "~/t3work/t3work-ResizableRightSidebarLayout";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";

export function useHomeProjectChat(input: {
  projects: ProjectShellProject[];
  getThreadsForProject: (projectId: string) => ProjectThread[];
}) {
  const { getThreadsForProject } = input;

  const homeChatProject = useMemo(() => createHomeProject(), []);
  const homeChatThreadId = useMemo(() => {
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
  const { view } = input;
  const setActiveChatTarget = useT3WorkActiveChatStore((state) => state.setTarget);

  useEffect(() => {
    if (!view) {
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

    setActiveChatTarget(null);
  }, [setActiveChatTarget, view]);
}

function ProjectBrowserEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="drag-region flex h-13 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5 wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <span className="text-sm font-medium text-muted-foreground/70">No active project</span>
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
  projectThreads,
  providers,
  isConnected,
  onOpenThread,
  onKickoffThread,
  heading,
  description,
}: {
  onCreate: () => void;
  project: ProjectShellProject | null;
  projectThreads: ProjectThread[];
  providers: ReadonlyArray<import("@t3tools/contracts").ServerProvider>;
  isConnected: boolean;
  onOpenThread: (threadId: string) => void;
  onKickoffThread: (
    kickoffMessage: string,
    kickoffModelSelection: import("@t3tools/contracts").ModelSelection,
    kickoffRuntimeMode: import("@t3tools/contracts").RuntimeMode,
    kickoffInteractionMode: import("@t3tools/contracts").ProviderInteractionMode,
    kickoffContextAttachments: ReadonlyArray<T3WorkContextAttachment>,
  ) => void;
  heading?: string;
  description?: string;
}) {
  return (
    <ResizableRightSidebarLayout
      storageKey="t3work_home_right_sidebar"
      defaultAsideWidth={28 * 16}
      minAsideWidth={24 * 16}
      main={<ProjectBrowserEmpty onCreate={onCreate} />}
      aside={
        project ? (
          <ProjectDashboardKickoffAside
            project={project}
            projectThreads={projectThreads}
            providers={providers}
            isConnected={isConnected}
            onOpenThread={onOpenThread}
            onKickoffThread={onKickoffThread}
          />
        ) : (
          <aside className="flex min-h-0 h-full flex-1 items-center justify-center border-l border-border/70 bg-background px-6 text-center text-sm text-muted-foreground">
            Create a project to start chatting.
          </aside>
        )
      }
    />
  );
}
