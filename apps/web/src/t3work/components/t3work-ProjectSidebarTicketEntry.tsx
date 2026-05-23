import type { ProjectShellProject } from "@t3tools/project-context";
import { useMemo, type MouseEvent } from "react";

import { SidebarMenuSubButton } from "~/t3work/components/ui/t3work-sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/t3work/components/ui/t3work-tooltip";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import { useTicketAgentContext } from "~/t3work/hooks/t3work-useTicketAgentContext";
import { T3WorkAgentContextDropOverlay } from "~/t3work/t3work-agentContextDrag";
import { TicketCardDetailsTooltip } from "~/t3work/t3work-TicketCardDetailsTooltip";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import { useAgentContext } from "~/t3work/hooks/t3work-useAgentContext";
import { buildTicketSidebarPinnedItemId } from "~/t3work/t3work-sidebarPinningTypes";
import { ThreadRow } from "./t3work-ProjectSidebarThreadRow";
import { ProjectSidebarTicketEntryActions } from "./t3work-ProjectSidebarTicketEntryActions";
import { ProjectSidebarTicketEntryGitHubActivity } from "./t3work-ProjectSidebarTicketEntryGitHubActivity";
import { useProjectSidebarNavItemDnd } from "./t3work-useProjectSidebarNavItemDnd";
import {
  readActiveThreadIdFromView,
  type ProjectThread,
  type ProjectTicket,
  type ViewState,
} from "~/t3work/t3work-types";

export interface TicketSidebarEntryProps {
  project: ProjectShellProject;
  projectTickets: ReadonlyArray<ProjectTicket>;
  ticket: ProjectTicket;
  projectId: string;
  view: ViewState | null;
  ticketThreads: readonly ProjectThread[];
  jiraLastCheckedAt?: number;
  githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
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
  sidebarNavOrderScopeIds?: ReadonlyArray<string>;
}

export function TicketSidebarEntry({
  project,
  projectTickets,
  ticket,
  projectId,
  view,
  ticketThreads,
  jiraLastCheckedAt,
  githubActivityItems,
  githubActivityLastCheckedAt,
  showGitHubActivity,
  onSelectTicket,
  onCreateTicketThread,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
  sidebarNavOrderScopeIds = [],
}: TicketSidebarEntryProps) {
  const { runAgentContextAction } = useAgentContext();
  const githubActivityByWorkItem = useMemo(
    () =>
      new Map<string, readonly GitHubWorkActivityItem[]>([
        [ticket.ref.displayId, githubActivityItems],
      ]),
    [githubActivityItems, ticket.ref.displayId],
  );
  const {
    getTicketAgentContext,
    getGitHubActivityAgentContext,
    openTicketAgentContextMenu,
    openTicketAgentContextMenuAt,
    openGitHubActivityAgentContextMenu,
  } = useTicketAgentContext({
    project,
    projectTickets,
    githubActivityByWorkItem,
  });
  const ticketSidebarItemId = buildTicketSidebarPinnedItemId({ projectId, ticketId: ticket.id });
  const ticketAgentContext = getTicketAgentContext(ticket, { visibleInSidebar: true });
  const { dragProps, dropProps, isDropActive } = useProjectSidebarNavItemDnd({
    projectId,
    itemId: ticketSidebarItemId,
    label: `${ticket.ref.displayId} ${ticket.ref.title}`,
    capabilities: ticketAgentContext,
    scopeItemIds: sidebarNavOrderScopeIds,
  });

  const handleContextMenu = (event: MouseEvent) => {
    openTicketAgentContextMenu(event, ticket, { visibleInSidebar: true });
  };

  const handleOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openTicketAgentContextMenuAt(
      ticket,
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.bottom),
      { visibleInSidebar: true },
    );
  };
  const activeThreadId = readActiveThreadIdFromView(view);

  return (
    <div
      className="group/ticket relative rounded-md bg-background/25 px-1 py-0.5"
      onContextMenu={handleContextMenu}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      {...dropProps}
    >
      <T3WorkAgentContextDropOverlay
        active={isDropActive}
        label="Drop to move this work item"
        className="rounded-md"
      />
      <div className="relative">
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuSubButton
                size="sm"
                isActive={view?.type === "ticket" && view.ticketId === ticket.id}
                className="h-auto min-h-8 w-full cursor-grab flex-col items-start py-1 active:cursor-grabbing"
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
        <ProjectSidebarTicketEntryActions
          displayId={ticket.ref.displayId}
          onCreateThread={async (event) => {
            event.stopPropagation();
            const threadId = onCreateTicketThread({
              projectId,
              ticketId: ticket.id,
              ticketDisplayId: ticket.ref.displayId,
            });
            if (!ticketAgentContext) {
              return;
            }
            await runAgentContextAction(ticketAgentContext, "add-to-chat", {
              addToChatTarget: { type: "thread", threadId },
            });
          }}
          onOpenMenu={handleOpenMenu}
        />
      </div>

      {ticketThreads.length > 0 ? (
        <div className="mt-1 ml-2 space-y-1 pl-2">
          {ticketThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              variant="issue"
              isActive={activeThreadId === thread.id}
              onSelect={() => onSelectThread(projectId, thread.id)}
              onDelete={() => onDeleteThread(thread.id)}
              onRename={(newTitle) => onRenameThread(thread.id, newTitle)}
              wrapWithMenuItem={false}
            />
          ))}
        </div>
      ) : null}

      <ProjectSidebarTicketEntryGitHubActivity
        items={githubActivityItems}
        showGitHubActivity={showGitHubActivity}
        {...(githubActivityLastCheckedAt !== undefined
          ? { lastCheckedAt: githubActivityLastCheckedAt }
          : {})}
        onItemContextMenu={(event, item) => {
          openGitHubActivityAgentContextMenu(event, ticket, item);
        }}
        getItemDragCapabilities={(item) => getGitHubActivityAgentContext(ticket, item)}
      />
    </div>
  );
}
