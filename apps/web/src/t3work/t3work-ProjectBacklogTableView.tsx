import { memo, useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import { useProjectBacklogTableGroupState } from "~/t3work/hooks/t3work-useProjectBacklogTableGroupState";
import { ProjectBacklogTableGroupSection } from "~/t3work/t3work-ProjectBacklogTableGroupSection";
import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import type { ProjectBacklogTicketContext } from "~/t3work/t3work-projectBacklogPresentation";
import {
  buildProjectBacklogTableGroups,
  type ProjectBacklogTableColumnId,
  type ProjectBacklogTableGroupBy,
  type ProjectBacklogTableSortBy,
  type ProjectBacklogTableSortDirection,
} from "~/t3work/t3work-projectBacklogTable";
import {
  getProjectBacklogTableColumnHeaderLabel,
  getProjectBacklogTableColumnSortBy,
  getProjectBacklogTableMinWidth,
  projectBacklogTableColumnWidthById,
  resolveProjectBacklogTableVisibleColumns,
} from "~/t3work/t3work-projectBacklogTableViewMeta";
import type { ProjectBacklogSubtaskCreateInput, ProjectTicket } from "~/t3work/t3work-types";

export const ProjectBacklogTableView = memo(function ProjectBacklogTableView({
  projectId,
  tickets,
  contextByTicketId,
  groupBy,
  sortBy,
  sortDirection,
  visibleColumns,
  collapseGroupsRequestKey,
  expandGroupsRequestKey,
  estimateFieldLabel,
  canCreateSubtasks,
  onTicketContextMenu,
  getTicketAgentContext,
  onOpenTicket,
  onSearchAssignableUsers,
  onUpdateAssignee,
  onUpdateEstimate,
  onCreateSubtask,
  onSortByChange,
  onSortDirectionChange,
}: {
  projectId: string;
  tickets: readonly ProjectTicket[];
  contextByTicketId: ReadonlyMap<string, ProjectBacklogTicketContext>;
  groupBy: ProjectBacklogTableGroupBy;
  sortBy: ProjectBacklogTableSortBy;
  sortDirection: ProjectBacklogTableSortDirection;
  visibleColumns: readonly ProjectBacklogTableColumnId[];
  collapseGroupsRequestKey: number;
  expandGroupsRequestKey: number;
  estimateFieldLabel?: string;
  canCreateSubtasks: boolean;
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
  onSortByChange: (value: ProjectBacklogTableSortBy) => void;
  onSortDirectionChange: (value: ProjectBacklogTableSortDirection) => void;
}) {
  const groups = useMemo(
    () =>
      buildProjectBacklogTableGroups({
        tickets,
        contextByTicketId,
        groupBy,
        sortBy,
        sortDirection,
      }),
    [contextByTicketId, groupBy, sortBy, sortDirection, tickets],
  );
  const visibleTableColumns = resolveProjectBacklogTableVisibleColumns(visibleColumns);
  const tableMinWidth = getProjectBacklogTableMinWidth(visibleColumns);
  const { collapsedGroupIds, toggleGroup } = useProjectBacklogTableGroupState({
    groupIds: groups.map((group) => group.id),
    groupBy,
    collapseGroupsRequestKey,
    expandGroupsRequestKey,
  });

  const handleSortChange = useCallback(
    (nextSortBy: ProjectBacklogTableSortBy) => {
      if (sortBy === nextSortBy) {
        onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc");
        return;
      }
      onSortByChange(nextSortBy);
    },
    [onSortByChange, onSortDirectionChange, sortBy, sortDirection],
  );

  function renderSortButton(label: string, column: ProjectBacklogTableSortBy) {
    const active = sortBy === column;
    return (
      <button
        type="button"
        className="inline-flex w-full items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => handleSortChange(column)}
      >
        <span>{label}</span>
        {active ? (
          sortDirection === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </button>
    );
  }

  function renderColumnHeader(columnId: ProjectBacklogTableColumnId) {
    const label = getProjectBacklogTableColumnHeaderLabel(columnId, estimateFieldLabel);
    const sortableColumn = getProjectBacklogTableColumnSortBy(columnId);
    return sortableColumn ? (
      renderSortButton(label, sortableColumn)
    ) : (
      <span className="font-semibold text-foreground/80">{label}</span>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="min-h-0 rounded-xl border border-border/70 bg-background/95 shadow-sm"
        scrollbarGutter
      >
        <table
          className="w-full table-fixed text-left text-[11px]"
          style={{ minWidth: `${tableMinWidth}px` }}
        >
          <colgroup>
            <col style={{ width: `${projectBacklogTableColumnWidthById.issue}px` }} />
            {visibleColumns.map((columnId) => (
              <col
                key={columnId}
                style={{ width: `${projectBacklogTableColumnWidthById[columnId]}px` }}
              />
            ))}
            <col style={{ width: `${projectBacklogTableColumnWidthById.actions}px` }} />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-background/95 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/72 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <tr>
              <th className="px-3 py-1.5">{renderSortButton("Issue", "title")}</th>
              {visibleTableColumns.map((column) => (
                <th key={column.value} className="px-3 py-1.5">
                  {renderColumnHeader(column.value)}
                </th>
              ))}
              <th className="sticky right-3 z-20 w-px whitespace-nowrap border-l border-border/60 bg-background/95 px-1.5 py-1.5 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 align-top">
            {groups.map((group) => {
              const collapsed = collapsedGroupIds.has(group.id);
              return (
                <ProjectBacklogTableGroupSection
                  key={group.id}
                  group={group}
                  collapsed={collapsed}
                  onToggleGroup={toggleGroup}
                  projectId={projectId}
                  contextByTicketId={contextByTicketId}
                  visibleColumns={visibleColumns}
                  canCreateSubtasks={canCreateSubtasks}
                  onTicketContextMenu={onTicketContextMenu}
                  getTicketAgentContext={getTicketAgentContext}
                  onOpenTicket={onOpenTicket}
                  onSearchAssignableUsers={onSearchAssignableUsers}
                  onUpdateAssignee={onUpdateAssignee}
                  onUpdateEstimate={onUpdateEstimate}
                  onCreateSubtask={onCreateSubtask}
                  {...(estimateFieldLabel ? { estimateFieldLabel } : {})}
                />
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
});
