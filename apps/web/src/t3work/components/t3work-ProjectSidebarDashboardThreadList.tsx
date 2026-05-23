import { SidebarMenuSub } from "~/t3work/components/ui/t3work-sidebar";
import type { ProjectThread } from "~/t3work/t3work-types";
import { ThreadRow } from "./t3work-ProjectSidebarThreadRow";

type ProjectSidebarDashboardThreadListProps = {
  projectId: string;
  threads: ReadonlyArray<ProjectThread>;
  activeThreadId: string | null;
  onSelectThread: (projectId: string, threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
};

export function ProjectSidebarDashboardThreadList({
  projectId,
  threads,
  activeThreadId,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
}: ProjectSidebarDashboardThreadListProps) {
  if (threads.length === 0) {
    return null;
  }

  return (
    <SidebarMenuSub className="mx-1 -mt-0.5 mb-1 w-full translate-x-0 gap-0.5 overflow-hidden px-3.5 py-0.5">
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          variant="issue"
          isActive={activeThreadId === thread.id}
          onSelect={() => onSelectThread(projectId, thread.id)}
          onDelete={() => onDeleteThread(thread.id)}
          onRename={(newTitle) => onRenameThread(thread.id, newTitle)}
        />
      ))}
    </SidebarMenuSub>
  );
}
