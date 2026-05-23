import type { MouseEvent } from "react";
import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import { Skeleton } from "~/t3work/components/ui/t3work-skeleton";

import { ProjectBacklogHierarchyView } from "~/t3work/t3work-ProjectBacklogHierarchyView";
import { ProjectBacklogOwnershipView } from "~/t3work/t3work-ProjectBacklogOwnershipView";
import { ProjectBacklogPlanningView } from "~/t3work/t3work-ProjectBacklogPlanningView";
import { ProjectBacklogTableView } from "~/t3work/t3work-ProjectBacklogTableView";
import type {
  ProjectBacklogOwnershipGroup,
  ProjectBacklogPlanningLane,
  ProjectBacklogTicketContext,
  ProjectBacklogViewMode,
} from "~/t3work/t3work-projectBacklogPresentation";
import type {
  ProjectBacklogTableColumnId,
  ProjectBacklogTableGroupBy,
  ProjectBacklogTableSortBy,
  ProjectBacklogTableSortDirection,
} from "~/t3work/t3work-projectBacklogTable";
import type { ProjectTicketHierarchy } from "~/t3work/t3work-ticketHierarchy";
import type { ProjectBacklogSubtaskCreateInput, ProjectTicket } from "~/t3work/t3work-types";

export function ProjectDashboardBacklogContent({
  projectId,
  viewMode,
  loading,
  filteredTickets,
  hierarchy,
  contextByTicketId,
  matchedTicketIds,
  planningLanes,
  ownershipGroups,
  tableGroupBy,
  tableSortBy,
  tableSortDirection,
  visibleTableColumns,
  collapseGroupsRequestKey,
  expandGroupsRequestKey,
  canCreateSubtasks,
  estimateFieldLabel,
  onTicketContextMenu,
  getTicketAgentContext,
  onOpenTicket,
  onSearchAssignableUsers,
  onUpdateAssignee,
  onUpdateEstimate,
  onCreateSubtask,
  onTableSortByChange,
  onTableSortDirectionChange,
}: {
  projectId: string;
  viewMode: ProjectBacklogViewMode;
  loading: boolean;
  filteredTickets: readonly ProjectTicket[];
  hierarchy: ProjectTicketHierarchy;
  contextByTicketId: ReadonlyMap<string, ProjectBacklogTicketContext>;
  matchedTicketIds: ReadonlySet<string>;
  planningLanes: readonly ProjectBacklogPlanningLane[];
  ownershipGroups: readonly ProjectBacklogOwnershipGroup[];
  tableGroupBy: ProjectBacklogTableGroupBy;
  tableSortBy: ProjectBacklogTableSortBy;
  tableSortDirection: ProjectBacklogTableSortDirection;
  visibleTableColumns: readonly ProjectBacklogTableColumnId[];
  collapseGroupsRequestKey: number;
  expandGroupsRequestKey: number;
  canCreateSubtasks: boolean;
  estimateFieldLabel?: string;
  onTicketContextMenu: (event: MouseEvent, ticket: ProjectTicket) => void;
  getTicketAgentContext: (ticket: ProjectTicket) => AgentContextCapabilities | null;
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onSearchAssignableUsers: (
    ticket: ProjectTicket,
    query?: string,
  ) => Promise<ReadonlyArray<AtlassianAssignableUser>>;
  onUpdateAssignee: (
    ticket: ProjectTicket,
    assignee: AtlassianAssignableUser | null,
  ) => Promise<void>;
  onUpdateEstimate: (ticket: ProjectTicket, estimateValue: number | null) => Promise<void>;
  onCreateSubtask: (
    ticket: ProjectTicket,
    subtask: ProjectBacklogSubtaskCreateInput,
  ) => Promise<void>;
  onTableSortByChange: (value: ProjectBacklogTableSortBy) => void;
  onTableSortDirectionChange: (value: ProjectBacklogTableSortDirection) => void;
}) {
  const actionProps = {
    canCreateSubtasks,
    onOpenTicket,
    onSearchAssignableUsers,
    onUpdateAssignee,
    onUpdateEstimate,
    onCreateSubtask,
    ...(estimateFieldLabel ? { estimateFieldLabel } : {}),
  };

  if (loading && filteredTickets.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-background/70 p-4 sm:p-5">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-[92%]" />
          <Skeleton className="h-10 w-[84%]" />
          <Skeleton className="h-10 w-[88%]" />
        </div>
      </div>
    );
  }

  if (!loading && filteredTickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
        No backlog items match your current search and planning filter.
      </div>
    );
  }

  if (viewMode === "hierarchy") {
    return (
      <ProjectBacklogHierarchyView
        projectId={projectId}
        hierarchy={hierarchy}
        contextByTicketId={contextByTicketId}
        matchedTicketIds={matchedTicketIds}
        onTicketContextMenu={onTicketContextMenu}
        getTicketAgentContext={getTicketAgentContext}
        {...actionProps}
      />
    );
  }

  if (viewMode === "planning") {
    return (
      <ProjectBacklogPlanningView
        projectId={projectId}
        lanes={planningLanes}
        contextByTicketId={contextByTicketId}
        onTicketContextMenu={onTicketContextMenu}
        getTicketAgentContext={getTicketAgentContext}
        {...actionProps}
      />
    );
  }

  if (viewMode === "table") {
    return (
      <ProjectBacklogTableView
        projectId={projectId}
        tickets={filteredTickets}
        contextByTicketId={contextByTicketId}
        groupBy={tableGroupBy}
        sortBy={tableSortBy}
        sortDirection={tableSortDirection}
        visibleColumns={visibleTableColumns}
        collapseGroupsRequestKey={collapseGroupsRequestKey}
        expandGroupsRequestKey={expandGroupsRequestKey}
        onTicketContextMenu={onTicketContextMenu}
        getTicketAgentContext={getTicketAgentContext}
        onSortByChange={onTableSortByChange}
        onSortDirectionChange={onTableSortDirectionChange}
        {...actionProps}
      />
    );
  }

  return (
    <ProjectBacklogOwnershipView
      projectId={projectId}
      groups={ownershipGroups}
      contextByTicketId={contextByTicketId}
      onTicketContextMenu={onTicketContextMenu}
      getTicketAgentContext={getTicketAgentContext}
      {...actionProps}
    />
  );
}
