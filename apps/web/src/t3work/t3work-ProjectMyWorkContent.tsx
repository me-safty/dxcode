import type { ReactNode } from "react";

import { T3SurfacePanel } from "~/t3work/components/ui/t3work-surface";
import { useTicketAgentContext } from "~/t3work/hooks/t3work-useTicketAgentContext";
import { ProjectMyWorkTicketExtra } from "~/t3work/t3work-ProjectMyWorkTicketExtra";
import {
  ProjectDashboardKanban,
  type TicketHierarchy,
} from "~/t3work/t3work-ProjectDashboardKanban";
import { ProjectMyWorkHierarchyView } from "~/t3work/t3work-ProjectMyWorkHierarchyView";
import { ProjectMyWorkTableView } from "~/t3work/t3work-ProjectMyWorkTableView";
import {
  DraggableTicketWorkItemCard,
  DraggableTicketWorkItemRow,
} from "~/t3work/t3work-DraggableTicketWorkItems";
import type {
  ProjectMyWorkTableSortBy,
  ProjectMyWorkTableSortDirection,
} from "~/t3work/t3work-projectDashboardMyWorkState";
import type { ProjectMyWorkVisibleHierarchy } from "~/t3work/t3work-projectMyWork";
import type { ProjectBacklogTableRow } from "~/t3work/t3work-projectBacklogTable";
import type { ProjectTicketKanbanColumns } from "~/t3work/t3work-projectTicketStatus";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectTicket } from "~/t3work/t3work-types";
import type { ProjectShellProject } from "@t3tools/project-context";

export function ProjectMyWorkContent({
  project,
  tickets,
  assignedWorkItems,
  filteredWorkItems,
  visibleHierarchy,
  viewMode,
  groupMode,
  showGitHubActivity,
  tableSortBy,
  tableSortDirection,
  kanbanColumns,
  parentChildGroups,
  githubActivityByWorkItem,
  jiraLastCheckedAt,
  githubLastCheckedAt,
  onTableSortByChange,
  onTableSortDirectionChange,
  onMoveTicketToStatus,
  onOpenTicket,
}: {
  project: ProjectShellProject;
  tickets: readonly ProjectTicket[];
  assignedWorkItems: readonly ProjectTicket[];
  filteredWorkItems: readonly ProjectTicket[];
  visibleHierarchy: ProjectMyWorkVisibleHierarchy;
  viewMode: "table" | "list" | "grid" | "kanban";
  groupMode: "flat" | "hierarchy";
  showGitHubActivity: boolean;
  tableSortBy: ProjectMyWorkTableSortBy;
  tableSortDirection: ProjectMyWorkTableSortDirection;
  kanbanColumns: ProjectTicketKanbanColumns;
  parentChildGroups: TicketHierarchy;
  githubActivityByWorkItem: ReadonlyMap<string, ReadonlyArray<GitHubWorkActivityItem>>;
  jiraLastCheckedAt?: number;
  githubLastCheckedAt?: number;
  onTableSortByChange: (value: ProjectMyWorkTableSortBy) => void;
  onTableSortDirectionChange: (value: ProjectMyWorkTableSortDirection) => void;
  onMoveTicketToStatus?: (ticket: ProjectTicket, targetStatus: string) => Promise<string>;
  onOpenTicket: (projectId: string, ticketId: string) => void;
}) {
  const {
    getTicketAgentContext,
    getGitHubActivityAgentContext,
    openTicketAgentContextMenu,
    openGitHubActivityAgentContextMenu,
  } = useTicketAgentContext({ project, projectTickets: tickets, githubActivityByWorkItem });
  const isHierarchyMode = groupMode === "hierarchy" && viewMode !== "kanban";
  const tableRows: ReadonlyArray<ProjectBacklogTableRow> = isHierarchyMode
    ? visibleHierarchy.rows
    : filteredWorkItems.map((ticket) => ({ ticket, depth: 0, isContextOnly: false }));

  function renderTicketExtra(ticket: ProjectTicket, _isContextOnly: boolean, compact = false) {
    return (
      <ProjectMyWorkTicketExtra
        ticket={ticket}
        showGitHubActivity={showGitHubActivity}
        githubActivityByWorkItem={githubActivityByWorkItem}
        {...(githubLastCheckedAt !== undefined ? { githubLastCheckedAt } : {})}
        {...(compact ? { compact } : {})}
        onGitHubActivityContextMenu={openGitHubActivityAgentContextMenu}
        getGitHubActivityDragCapabilities={(workItem, item) =>
          getGitHubActivityAgentContext(workItem, item)
        }
      />
    );
  }

  const emptyStateMessage =
    assignedWorkItems.length === 0
      ? "No Jira issues are currently assigned to you in this project."
      : filteredWorkItems.length === 0
        ? "No assigned issues match your current search and filters."
        : null;
  if (emptyStateMessage) {
    return (
      <T3SurfacePanel tone="dashed" className="px-4 py-8 text-sm text-muted-foreground">
        {emptyStateMessage}
      </T3SurfacePanel>
    );
  }

  if (viewMode === "table") {
    return (
      <ProjectMyWorkTableView
        projectId={project.id}
        rows={tableRows}
        showGitHubActivity={showGitHubActivity}
        sortBy={tableSortBy}
        sortDirection={tableSortDirection}
        githubActivityByWorkItem={githubActivityByWorkItem}
        {...(githubLastCheckedAt !== undefined ? { githubLastCheckedAt } : {})}
        onSortByChange={onTableSortByChange}
        onSortDirectionChange={onTableSortDirectionChange}
        onGitHubActivityContextMenu={openGitHubActivityAgentContextMenu}
        onTicketContextMenu={openTicketAgentContextMenu}
        onOpenTicket={onOpenTicket}
        getGitHubActivityDragCapabilities={(ticket, item) =>
          getGitHubActivityAgentContext(ticket, item)
        }
      />
    );
  }

  if (viewMode === "kanban") {
    return (
      <ProjectDashboardKanban
        kanbanColumns={kanbanColumns}
        allTickets={tickets}
        isHierarchyMode={groupMode === "hierarchy"}
        parentChildGroups={parentChildGroups}
        {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
        {...(githubLastCheckedAt !== undefined ? { githubLastCheckedAt } : {})}
        showGitHubActivity={showGitHubActivity}
        githubActivityByWorkItem={githubActivityByWorkItem}
        projectId={project.id}
        onOpenTicket={onOpenTicket}
        onTicketContextMenu={openTicketAgentContextMenu}
        onGitHubActivityContextMenu={openGitHubActivityAgentContextMenu}
        renderTicketExtra={(ticket, compact) => renderTicketExtra(ticket, false, compact)}
        {...(onMoveTicketToStatus ? { onMoveTicketToStatus } : {})}
      />
    );
  }

  if (isHierarchyMode) {
    return (
      <ProjectMyWorkHierarchyView
        projectId={project.id}
        viewMode={viewMode === "grid" ? "grid" : "list"}
        hierarchy={visibleHierarchy.hierarchy}
        contextByTicketId={visibleHierarchy.contextByTicketId}
        matchedTicketIds={visibleHierarchy.matchedTicketIds}
        {...(jiraLastCheckedAt !== undefined ? { jiraLastCheckedAt } : {})}
        onTicketContextMenu={openTicketAgentContextMenu}
        getTicketAgentContext={getTicketAgentContext}
        onOpenTicket={onOpenTicket}
        renderTicketExtra={renderTicketExtra}
      />
    );
  }

  if (viewMode === "list") {
    return (
      <T3SurfacePanel tone="muted" className="divide-y divide-border/70">
        {filteredWorkItems.map((ticket) => (
          <div key={ticket.id} className="px-3 py-2.5 transition-colors hover:bg-accent/30">
            <DraggableTicketWorkItemRow
              capabilities={getTicketAgentContext(ticket)}
              dragLabel={`${ticket.ref.displayId} ${ticket.ref.title}`}
              ticket={ticket}
              {...(jiraLastCheckedAt !== undefined ? { lastCheckedAt: jiraLastCheckedAt } : {})}
              onContextMenu={(event) => openTicketAgentContextMenu(event, ticket)}
              extraChildren={renderTicketExtra(ticket, false)}
              onOpen={() => onOpenTicket(project.id, ticket.id)}
            />
          </div>
        ))}
      </T3SurfacePanel>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {filteredWorkItems.map((ticket) => (
        <T3SurfacePanel key={ticket.id} tone="muted" className="px-2.5 py-2">
          <DraggableTicketWorkItemCard
            capabilities={getTicketAgentContext(ticket)}
            dragLabel={`${ticket.ref.displayId} ${ticket.ref.title}`}
            ticket={ticket}
            flat
            {...(jiraLastCheckedAt !== undefined ? { lastCheckedAt: jiraLastCheckedAt } : {})}
            onContextMenu={(event) => openTicketAgentContextMenu(event, ticket)}
            extraChildren={renderTicketExtra(ticket, false)}
            onOpen={() => onOpenTicket(project.id, ticket.id)}
          />
        </T3SurfacePanel>
      ))}
    </div>
  );
}
