import { EllipsisIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/t3work/components/ui/t3work-tooltip";
import { SidebarMenuSubButton } from "~/t3work/components/ui/t3work-sidebar";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import { useTicketAgentContext } from "~/t3work/hooks/t3work-useTicketAgentContext";
import { TicketCardDetailsTooltip } from "~/t3work/t3work-TicketCardDetailsTooltip";
import { GitHubActivityInlineList } from "~/t3work/t3work-GitHubActivityViews";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import { T3WorkAgentContextDropOverlay } from "~/t3work/t3work-agentContextDrag";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import { sortSidebarItemsByStoredOrder } from "~/t3work/t3work-sidebarNavPreferences";
import type { ProjectTicket } from "~/t3work/t3work-types";
import type { ProjectShellProject } from "@t3tools/project-context";
import { useMemo } from "react";

import { useProjectSidebarNavItemDnd } from "./t3work-useProjectSidebarNavItemDnd";
import { useProjectSidebarNavItemPreferences } from "./t3work-useProjectSidebarNavItemPreferences";
import type { ResolvedPinnedSidebarItem } from "./t3work-useProjectSidebarPinnedItems";

function PinnedTicketRow({
  projectId,
  sidebarItemId,
  sidebarNavOrderScopeIds,
  ticket,
  ticketAgentContext,
  jiraLastCheckedAt,
  onSelectTicket,
  onContextMenu,
  onOpenMenu,
}: {
  projectId: string;
  sidebarItemId: string;
  sidebarNavOrderScopeIds: ReadonlyArray<string>;
  ticket: ProjectTicket;
  ticketAgentContext: AgentContextCapabilities | null;
  jiraLastCheckedAt?: number;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { dragProps, dropProps, isDropActive } = useProjectSidebarNavItemDnd({
    projectId,
    itemId: sidebarItemId,
    label: `${ticket.ref.displayId} ${ticket.ref.title}`,
    capabilities: ticketAgentContext,
    scopeItemIds: sidebarNavOrderScopeIds,
  });

  return (
    <div
      className="group/pinned-ticket relative"
      onContextMenu={onContextMenu}
      {...dropProps}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
    >
      <T3WorkAgentContextDropOverlay
        active={isDropActive}
        label="Drop to move this work item"
        className="rounded-md"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuSubButton
              size="sm"
              className="h-auto min-h-8 w-full cursor-grab flex-col items-start px-2 py-1 pr-7 active:cursor-grabbing"
              onClick={() => onSelectTicket(projectId, ticket.id)}
            />
          }
        >
          <div className="flex w-full items-center gap-1">
            <JiraIssueTypeIcon
              issueType={ticket.issueType}
              issueTypeIconUrl={ticket.issueTypeIconUrl ?? ticket.ref.issueTypeIconUrl}
            />
            <span className="truncate text-[11px] font-medium">{ticket.ref.displayId}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/75">{ticket.status}</span>
          </div>
          <div className="w-full truncate text-[10px] leading-tight text-muted-foreground/70">
            {ticket.ref.title}
          </div>
        </TooltipTrigger>
        <TooltipPopup side="top" align="start" className="max-w-84">
          <TicketCardDetailsTooltip
            ticket={ticket}
            {...(jiraLastCheckedAt !== undefined ? { lastCheckedAt: jiraLastCheckedAt } : {})}
          />
        </TooltipPopup>
      </Tooltip>
      <button
        type="button"
        aria-label={`Issue actions for ${ticket.ref.displayId}`}
        className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity duration-150 hover:bg-accent hover:text-foreground group-hover/pinned-ticket:opacity-100 group-focus-within/pinned-ticket:opacity-100"
        onClick={onOpenMenu}
      >
        <EllipsisIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function ProjectSidebarPinnedItems({
  project,
  projectTickets,
  githubActivityByWorkItem,
  items,
  jiraLastCheckedAt,
  githubActivityLastCheckedAt,
  onSelectTicket,
}: {
  project: ProjectShellProject;
  projectTickets: ReadonlyArray<ProjectTicket>;
  githubActivityByWorkItem: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
  items: ReadonlyArray<ResolvedPinnedSidebarItem>;
  jiraLastCheckedAt?: number;
  githubActivityLastCheckedAt?: number;
  onSelectTicket: (projectId: string, ticketId: string) => void;
}) {
  const {
    getTicketAgentContext,
    getGitHubActivityAgentContext,
    openTicketAgentContextMenu,
    openTicketAgentContextMenuAt,
    openGitHubActivityAgentContextMenu,
  } = useTicketAgentContext({ project, projectTickets, githubActivityByWorkItem });
  const { orderedItemIds } = useProjectSidebarNavItemPreferences(project.id);

  if (items.length === 0) {
    return null;
  }

  const sortedItems = useMemo(
    () =>
      sortSidebarItemsByStoredOrder(
        items.map((item) => ({ id: item.pinnedItem.id, item })),
        orderedItemIds,
      ).map((entry) => entry.item),
    [items, orderedItemIds],
  );
  const pinnedTicketSidebarItemIds = sortedItems
    .filter(
      (item): item is Extract<ResolvedPinnedSidebarItem, { kind: "jira-work-item" }> =>
        item.kind === "jira-work-item",
    )
    .map((item) => item.pinnedItem.id);

  return (
    <div className="space-y-1">
      <div className="px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
        Pinned
      </div>
      <div className="space-y-1">
        {sortedItems.map((item) =>
          item.kind === "jira-work-item" ? (
            <PinnedTicketRow
              key={item.pinnedItem.id}
              projectId={project.id}
              sidebarItemId={item.pinnedItem.id}
              sidebarNavOrderScopeIds={pinnedTicketSidebarItemIds}
              ticket={item.ticket}
              ticketAgentContext={getTicketAgentContext(item.ticket, { visibleInSidebar: true })}
              {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
              onSelectTicket={onSelectTicket}
              onContextMenu={(event) =>
                openTicketAgentContextMenu(event, item.ticket, { visibleInSidebar: true })
              }
              onOpenMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                openTicketAgentContextMenuAt(
                  item.ticket,
                  Math.round(rect.left + rect.width / 2),
                  Math.round(rect.bottom),
                  { visibleInSidebar: true },
                );
              }}
            />
          ) : (
            <GitHubActivityInlineList
              key={item.pinnedItem.id}
              items={[item.item]}
              limit={1}
              compact
              {...(githubActivityLastCheckedAt !== undefined
                ? { lastCheckedAt: githubActivityLastCheckedAt }
                : {})}
              onItemContextMenu={(event, activity) => {
                openGitHubActivityAgentContextMenu(event, item.linkedWorkItem, activity);
              }}
              getItemDragCapabilities={(activity) =>
                getGitHubActivityAgentContext(item.linkedWorkItem, activity)
              }
            />
          ),
        )}
      </div>
    </div>
  );
}
