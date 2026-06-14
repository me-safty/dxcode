/**
 * Props contract for ProjectDashboardBacklogContent. Split out of
 * t3work-ProjectDashboardBacklogContent.tsx to keep the component under the LOC
 * budget.
 */

import type { MouseEvent } from "react";

import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
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

export interface ProjectDashboardBacklogContentProps {
  projectId: string;
  viewMode: ProjectBacklogViewMode;
  loading: boolean;
  selectedSprintId?: string | undefined;
  currentUserAccountId?: string | undefined;
  currentUserDisplayName?: string | undefined;
  /** Tempo capacity per owner accountId for the selected sprint window. */
  ownerCapacities?: ReadonlyMap<string, number> | undefined;
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
}
