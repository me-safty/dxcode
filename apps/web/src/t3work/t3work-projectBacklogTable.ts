export {
  defaultProjectBacklogTableVisibleColumns,
  getDefaultProjectBacklogTableSortDirection,
  projectBacklogTableColumnOptions,
  projectBacklogTableColumnValues,
  projectBacklogTableGroupOptions,
  projectBacklogTableSortOptions,
} from "./t3work-projectBacklogTableMeta";
export type {
  ProjectBacklogTableColumnId,
  ProjectBacklogTableGroupBy,
  ProjectBacklogTableSortBy,
  ProjectBacklogTableSortDirection,
} from "./t3work-projectBacklogTableMeta";

import type { ProjectBacklogTicketContext } from "./t3work-projectBacklogPresentation";
import type {
  ProjectBacklogTableGroupBy,
  ProjectBacklogTableSortBy,
  ProjectBacklogTableSortDirection,
} from "./t3work-projectBacklogTableMeta";
import {
  compareProjectBacklogTableGroupLabels,
  getProjectBacklogTableGroupDescriptor,
} from "./t3work-projectBacklogTableGrouping";
import { sortProjectBacklogTableTickets } from "./t3work-projectBacklogTableSorting";
import type { ProjectTicket } from "./t3work-types";

export interface ProjectBacklogTableRow {
  ticket: ProjectTicket;
  depth: number;
  isContextOnly: boolean;
}

export interface ProjectBacklogTableGroup {
  id: string;
  label: string;
  description?: string;
  matchedCount: number;
  contextCount: number;
  rows: readonly ProjectBacklogTableRow[];
}

export function areProjectBacklogTableRowsEqual(
  left: ProjectBacklogTableRow,
  right: ProjectBacklogTableRow,
): boolean {
  return (
    left.ticket === right.ticket &&
    left.depth === right.depth &&
    left.isContextOnly === right.isContextOnly
  );
}

function areProjectBacklogTableRowListsEqual(
  left: readonly ProjectBacklogTableRow[],
  right: readonly ProjectBacklogTableRow[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((row, index) => areProjectBacklogTableRowsEqual(row, right[index]!));
}

export function areProjectBacklogTableGroupsEqual(
  left: ProjectBacklogTableGroup,
  right: ProjectBacklogTableGroup,
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.description === right.description &&
    left.matchedCount === right.matchedCount &&
    left.contextCount === right.contextCount &&
    areProjectBacklogTableRowListsEqual(left.rows, right.rows)
  );
}

interface ProjectBacklogTableGroupBucket {
  id: string;
  label: string;
  description?: string;
  order: number;
  matchedCount: number;
  rowsByTicketId: Map<string, ProjectBacklogTableRow>;
}

export function buildProjectBacklogTableGroups({
  tickets,
  contextByTicketId,
  groupBy,
  sortBy,
  sortDirection,
}: {
  tickets: readonly ProjectTicket[];
  contextByTicketId: ReadonlyMap<string, ProjectBacklogTicketContext>;
  groupBy: ProjectBacklogTableGroupBy;
  sortBy: ProjectBacklogTableSortBy;
  sortDirection: ProjectBacklogTableSortDirection;
}): readonly ProjectBacklogTableGroup[] {
  const sortedTickets = sortProjectBacklogTableTickets({ tickets, sortBy, sortDirection });
  const groups = new Map<string, ProjectBacklogTableGroupBucket>();

  for (const ticket of sortedTickets) {
    const context = contextByTicketId.get(ticket.id);
    const group = getProjectBacklogTableGroupDescriptor(ticket, groupBy, context);

    let current = groups.get(group.id);
    if (!current) {
      current = {
        id: group.id,
        label: group.label,
        ...(group.description ? { description: group.description } : {}),
        order: group.order,
        matchedCount: 0,
        rowsByTicketId: new Map<string, ProjectBacklogTableRow>(),
      };
      groups.set(group.id, current);
    }

    current.matchedCount += 1;
    const chain = [...(context?.ancestors ?? []), ticket];
    chain.forEach((chainTicket, depth) => {
      const existing = current.rowsByTicketId.get(chainTicket.id);
      if (existing) {
        if (chainTicket.id === ticket.id) {
          existing.isContextOnly = false;
        }
        if (depth < existing.depth) {
          existing.depth = depth;
        }
        return;
      }

      current.rowsByTicketId.set(chainTicket.id, {
        ticket: chainTicket,
        depth,
        isContextOnly: chainTicket.id !== ticket.id,
      });
    });
  }

  return [...groups.values()]
    .toSorted((left, right) => {
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) return orderDelta;
      return compareProjectBacklogTableGroupLabels(left.label, right.label);
    })
    .map((group) => {
      const nextGroup: ProjectBacklogTableGroup = {
        id: group.id,
        label: group.label,
        matchedCount: group.matchedCount,
        contextCount: group.rowsByTicketId.size - group.matchedCount,
        rows: [...group.rowsByTicketId.values()],
      };

      if (group.description) {
        nextGroup.description = group.description;
      }

      return nextGroup;
    });
}

export function getProjectBacklogTableExpandableTicketIds(
  rows: readonly ProjectBacklogTableRow[],
): ReadonlySet<string> {
  const rowTicketIds = new Set(rows.map((row) => row.ticket.id));
  const expandableTicketIds = new Set<string>();

  for (const row of rows) {
    if (row.ticket.parentId && rowTicketIds.has(row.ticket.parentId)) {
      expandableTicketIds.add(row.ticket.parentId);
    }
  }

  return expandableTicketIds;
}

export function filterVisibleProjectBacklogTableRows({
  rows,
  contextByTicketId,
  collapsedTicketIds,
}: {
  rows: readonly ProjectBacklogTableRow[];
  contextByTicketId: ReadonlyMap<string, ProjectBacklogTicketContext>;
  collapsedTicketIds: ReadonlySet<string>;
}): readonly ProjectBacklogTableRow[] {
  if (collapsedTicketIds.size === 0) {
    return rows;
  }

  return rows.filter(
    (row) =>
      !(contextByTicketId.get(row.ticket.id)?.ancestors ?? []).some((ancestor) =>
        collapsedTicketIds.has(ancestor.id),
      ),
  );
}
