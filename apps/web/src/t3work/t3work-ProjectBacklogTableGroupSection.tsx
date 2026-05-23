import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import type { ProjectBacklogTicketContext } from "~/t3work/t3work-projectBacklogPresentation";
import { ProjectBacklogTableRowView } from "~/t3work/t3work-projectBacklogTableRowView";
import {
  areProjectBacklogTableGroupsEqual,
  filterVisibleProjectBacklogTableRows,
  getProjectBacklogTableExpandableTicketIds,
  type ProjectBacklogTableColumnId,
  type ProjectBacklogTableGroup,
} from "~/t3work/t3work-projectBacklogTable";
import type { ProjectBacklogSubtaskCreateInput, ProjectTicket } from "~/t3work/t3work-types";
import { ChevronDown, ChevronRight } from "lucide-react";

type ProjectBacklogTableGroupSectionProps = {
  group: ProjectBacklogTableGroup;
  collapsed: boolean;
  onToggleGroup: (groupId: string) => void;
  projectId: string;
  contextByTicketId: ReadonlyMap<string, ProjectBacklogTicketContext>;
  visibleColumns: readonly ProjectBacklogTableColumnId[];
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
};

export const ProjectBacklogTableGroupSection = memo(function ProjectBacklogTableGroupSection({
  group,
  collapsed,
  onToggleGroup,
  projectId,
  contextByTicketId,
  visibleColumns,
  estimateFieldLabel,
  canCreateSubtasks,
  onTicketContextMenu,
  getTicketAgentContext,
  onOpenTicket,
  onSearchAssignableUsers,
  onUpdateAssignee,
  onUpdateEstimate,
  onCreateSubtask,
}: ProjectBacklogTableGroupSectionProps) {
  const [collapsedTicketIds, setCollapsedTicketIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setCollapsedTicketIds(new Set());
  }, [group.id]);

  const expandableTicketIds = useMemo(
    () => getProjectBacklogTableExpandableTicketIds(group.rows),
    [group.rows],
  );
  const visibleRows = useMemo(
    () =>
      filterVisibleProjectBacklogTableRows({
        rows: group.rows,
        contextByTicketId,
        collapsedTicketIds,
      }),
    [collapsedTicketIds, contextByTicketId, group.rows],
  );
  const groupSecondaryText = useMemo(
    () =>
      group.contextCount > 0
        ? `${group.description ? `${group.description} | ` : ""}${group.contextCount} context parent${group.contextCount === 1 ? "" : "s"}`
        : group.description,
    [group.contextCount, group.description],
  );
  const columnCount = visibleColumns.length + 2;

  const toggleTicket = useCallback((ticketId: string) => {
    setCollapsedTicketIds((current) => {
      const next = new Set(current);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }, []);

  return (
    <>
      <tr className="bg-muted/15">
        <td colSpan={columnCount} className="px-3 py-1.5 pr-4 sm:pr-5">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 text-left"
            onClick={() => onToggleGroup(group.id)}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {collapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {group.label}
                </span>
                {groupSecondaryText ? (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {groupSecondaryText}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              {group.matchedCount} matched
            </span>
          </button>
        </td>
      </tr>
      {collapsed
        ? null
        : visibleRows.map((row) =>
            (() => {
              const parentTicket = contextByTicketId.get(row.ticket.id)?.ancestors.at(-1);

              return (
                <ProjectBacklogTableRowView
                  key={`${group.id}:${row.ticket.id}`}
                  row={row}
                  projectId={projectId}
                  visibleColumns={visibleColumns}
                  ticketCollapsed={collapsedTicketIds.has(row.ticket.id)}
                  canToggleChildren={expandableTicketIds.has(row.ticket.id)}
                  canCreateSubtasks={canCreateSubtasks}
                  onTicketContextMenu={onTicketContextMenu}
                  getTicketAgentContext={getTicketAgentContext}
                  onToggleTicket={toggleTicket}
                  onOpenTicket={onOpenTicket}
                  onSearchAssignableUsers={onSearchAssignableUsers}
                  onUpdateAssignee={onUpdateAssignee}
                  onUpdateEstimate={onUpdateEstimate}
                  onCreateSubtask={onCreateSubtask}
                  {...(parentTicket ? { parentTicket } : {})}
                  {...(estimateFieldLabel ? { estimateFieldLabel } : {})}
                />
              );
            })(),
          )}
    </>
  );
}, areProjectBacklogTableGroupSectionPropsEqual);

function areProjectBacklogTableGroupSectionPropsEqual(
  previous: ProjectBacklogTableGroupSectionProps,
  next: ProjectBacklogTableGroupSectionProps,
): boolean {
  return (
    previous.collapsed === next.collapsed &&
    previous.projectId === next.projectId &&
    previous.contextByTicketId === next.contextByTicketId &&
    previous.visibleColumns === next.visibleColumns &&
    previous.estimateFieldLabel === next.estimateFieldLabel &&
    previous.canCreateSubtasks === next.canCreateSubtasks &&
    previous.onTicketContextMenu === next.onTicketContextMenu &&
    previous.getTicketAgentContext === next.getTicketAgentContext &&
    previous.onToggleGroup === next.onToggleGroup &&
    previous.onOpenTicket === next.onOpenTicket &&
    previous.onSearchAssignableUsers === next.onSearchAssignableUsers &&
    previous.onUpdateAssignee === next.onUpdateAssignee &&
    previous.onUpdateEstimate === next.onUpdateEstimate &&
    previous.onCreateSubtask === next.onCreateSubtask &&
    areProjectBacklogTableGroupsEqual(previous.group, next.group)
  );
}
