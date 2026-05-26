import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import { T3WorkAgentContextDropOverlay } from "~/t3work/t3work-agentContextDrag";
import { SidebarMenuSubButton } from "~/t3work/components/ui/t3work-sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/t3work/components/ui/t3work-tooltip";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import { TicketCardDetailsTooltip } from "~/t3work/t3work-TicketCardDetailsTooltip";
import type { ProjectTicket } from "~/t3work/t3work-types";
import { EllipsisIcon, MessageSquareIcon } from "lucide-react";

import { useProjectSidebarNavItemDnd } from "./t3work-useProjectSidebarNavItemDnd";
import {
  getSidebarSurfaceClassName,
  getSidebarWrappedButtonClassName,
  type SidebarItemState,
} from "./t3work-projectSidebarItemState";
import { useAutoScrollIntoView } from "./t3work-useAutoScrollIntoView";

export function PinnedTicketRow({
  projectId,
  sidebarItemId,
  sidebarNavOrderScopeIds,
  ticket,
  state,
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
  state: SidebarItemState;
  ticketAgentContext: AgentContextCapabilities | null;
  jiraLastCheckedAt?: number;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const rowRef = useAutoScrollIntoView<HTMLAnchorElement>(state.isOpen);
  const { dragProps, dropProps, isDropActive } = useProjectSidebarNavItemDnd({
    projectId,
    itemId: sidebarItemId,
    label: `${ticket.ref.displayId} ${ticket.ref.title}`,
    capabilities: ticketAgentContext,
    scopeItemIds: sidebarNavOrderScopeIds,
  });

  return (
    <div
      className={`group/pinned-ticket relative ${getSidebarSurfaceClassName(state)}`}
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
              ref={rowRef}
              size="sm"
              isActive={state.isSelected}
              className={`h-auto min-h-8 w-full cursor-grab flex-col items-start px-2 py-1 pr-7 active:cursor-grabbing ${getSidebarWrappedButtonClassName(
                state,
              )}`}
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

export function PinnedTicketFallbackRow({
  state,
  onSelectTicket,
  projectId,
  ticketDisplayId,
  ticketId,
  title,
}: {
  state: SidebarItemState;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  projectId: string;
  ticketDisplayId: string;
  ticketId: string;
  title: string;
}) {
  const rowRef = useAutoScrollIntoView<HTMLAnchorElement>(state.isOpen);

  return (
    <div className={`group/pinned-ticket relative ${getSidebarSurfaceClassName(state)}`}>
      <SidebarMenuSubButton
        ref={rowRef}
        size="sm"
        isActive={state.isSelected}
        className={`h-auto min-h-8 w-full flex-col items-start px-2 py-1 ${getSidebarWrappedButtonClassName(
          state,
        )}`}
        onClick={() => onSelectTicket(projectId, ticketId)}
      >
        <div className="flex w-full items-center gap-1">
          <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-[11px] font-medium">{ticketDisplayId}</span>
          <span className="ml-1 text-[10px] text-muted-foreground/75">Thread</span>
        </div>
        <div className="w-full truncate text-[10px] leading-tight text-muted-foreground/70">
          {title}
        </div>
      </SidebarMenuSubButton>
    </div>
  );
}
