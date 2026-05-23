import type { ProjectShellProject } from "@t3tools/project-context";
import { SidebarMenuSub, SidebarMenuSubItem } from "~/t3work/components/ui/t3work-sidebar";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import { buildTicketSidebarPinnedItemId } from "~/t3work/t3work-sidebarPinningTypes";
import type { TicketViewMode } from "./t3work-projectSidebarShared";
import { TicketSidebarEntry } from "./t3work-ProjectSidebarTicketEntry";
import { TicketTreeNode } from "./t3work-ProjectSidebarTicketTree";
import { useProjectSidebarNavItemPreferences } from "./t3work-useProjectSidebarNavItemPreferences";
import type { ProjectThread, ProjectTicket, ViewState } from "~/t3work/t3work-types";

type ProjectSidebarCurrentIssuesContentProps = {
  project: ProjectShellProject;
  projectTickets: ReadonlyArray<ProjectTicket>;
  ticketViewMode: TicketViewMode;
  view: ViewState | null;
  visibleTreeRoots: ReadonlyArray<ProjectTicket>;
  visibleFlatTickets: ReadonlyArray<ProjectTicket>;
  visibleTreeUnresolvedChildren: ReadonlyArray<ProjectTicket>;
  hiddenTicketCount: number;
  childrenByParentId: ReadonlyMap<string, readonly ProjectTicket[]>;
  ticketThreadsById: ReadonlyMap<string, readonly ProjectThread[]>;
  githubActivityByWorkItem: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
  jiraLastCheckedAt?: number;
  githubActivityLastCheckedAt?: number;
  showGitHubActivity: boolean;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onCreateTicketThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
  }) => string;
  onSelectThread: (projectId: string, threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
};

export function ProjectSidebarCurrentIssuesContent({
  project,
  projectTickets,
  ticketViewMode,
  view,
  visibleTreeRoots,
  visibleFlatTickets,
  visibleTreeUnresolvedChildren,
  hiddenTicketCount,
  childrenByParentId,
  ticketThreadsById,
  githubActivityByWorkItem,
  jiraLastCheckedAt,
  githubActivityLastCheckedAt,
  showGitHubActivity,
  onSelectTicket,
  onCreateTicketThread,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
}: ProjectSidebarCurrentIssuesContentProps) {
  const { hiddenItemIds, orderedItemIds } = useProjectSidebarNavItemPreferences(project.id);

  if (projectTickets.length === 0) {
    return null;
  }

  const flatSidebarItemIds = visibleFlatTickets.map((ticket) =>
    buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: ticket.id }),
  );
  const rootSidebarItemIds = visibleTreeRoots.map((ticket) =>
    buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: ticket.id }),
  );
  const unresolvedSidebarItemIds = visibleTreeUnresolvedChildren.map((ticket) =>
    buildTicketSidebarPinnedItemId({ projectId: project.id, ticketId: ticket.id }),
  );

  return (
    <SidebarMenuSub className="mx-1 mt-1.5 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 pb-0.5">
      {ticketViewMode === "tree"
        ? visibleTreeRoots.map((ticket) => (
            <SidebarMenuSubItem key={ticket.id} className="w-full">
              <TicketTreeNode
                project={project}
                projectTickets={projectTickets}
                ticket={ticket}
                projectId={project.id}
                view={view}
                childrenByParentId={childrenByParentId}
                ticketThreadsById={ticketThreadsById}
                githubActivityByWorkItem={githubActivityByWorkItem}
                {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
                {...(githubActivityLastCheckedAt !== undefined
                  ? { githubActivityLastCheckedAt }
                  : {})}
                showGitHubActivity={showGitHubActivity}
                onSelectTicket={onSelectTicket}
                onCreateTicketThread={onCreateTicketThread}
                onSelectThread={onSelectThread}
                onDeleteThread={onDeleteThread}
                onRenameThread={onRenameThread}
                hiddenSidebarItemIds={hiddenItemIds}
                orderedSidebarItemIds={orderedItemIds}
                siblingSidebarItemIds={rootSidebarItemIds}
              />
            </SidebarMenuSubItem>
          ))
        : visibleFlatTickets.map((ticket) => (
            <SidebarMenuSubItem key={ticket.id} className="w-full">
              <TicketSidebarEntry
                project={project}
                projectTickets={projectTickets}
                ticket={ticket}
                projectId={project.id}
                view={view}
                ticketThreads={ticketThreadsById.get(ticket.id) ?? []}
                {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
                githubActivityItems={githubActivityByWorkItem.get(ticket.ref.displayId) ?? []}
                {...(githubActivityLastCheckedAt !== undefined
                  ? { githubActivityLastCheckedAt }
                  : {})}
                showGitHubActivity={showGitHubActivity}
                onSelectTicket={onSelectTicket}
                onCreateTicketThread={onCreateTicketThread}
                onSelectThread={onSelectThread}
                onDeleteThread={onDeleteThread}
                onRenameThread={onRenameThread}
                sidebarNavOrderScopeIds={flatSidebarItemIds}
              />
            </SidebarMenuSubItem>
          ))}

      {ticketViewMode === "tree" && visibleTreeUnresolvedChildren.length > 0 && (
        <div className="mt-1 space-y-1">
          <div className="px-2 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
            Unlinked
          </div>
          {visibleTreeUnresolvedChildren.map((ticket) => (
            <SidebarMenuSubItem key={ticket.id} className="w-full">
              <TicketSidebarEntry
                project={project}
                projectTickets={projectTickets}
                ticket={ticket}
                projectId={project.id}
                view={view}
                ticketThreads={ticketThreadsById.get(ticket.id) ?? []}
                {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
                githubActivityItems={githubActivityByWorkItem.get(ticket.ref.displayId) ?? []}
                {...(githubActivityLastCheckedAt !== undefined
                  ? { githubActivityLastCheckedAt }
                  : {})}
                showGitHubActivity={showGitHubActivity}
                onSelectTicket={onSelectTicket}
                onCreateTicketThread={onCreateTicketThread}
                onSelectThread={onSelectThread}
                onDeleteThread={onDeleteThread}
                onRenameThread={onRenameThread}
                sidebarNavOrderScopeIds={unresolvedSidebarItemIds}
              />
            </SidebarMenuSubItem>
          ))}
        </div>
      )}

      {hiddenTicketCount > 0 && (
        <SidebarMenuSubItem>
          <div className="px-2 py-1 text-[10px] text-muted-foreground/60">
            +{hiddenTicketCount} more
          </div>
        </SidebarMenuSubItem>
      )}
    </SidebarMenuSub>
  );
}
