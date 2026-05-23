import { useMemo } from "react";

import {
  buildProjectMyWorkKanbanLaneOptions,
  buildProjectMyWorkTypeOptions,
  filterProjectMyWorkKanbanTicketsByHiddenColumns,
  type ProjectMyWorkIdentity,
  type ProjectMyWorkStatusCategory,
} from "~/t3work/t3work-projectMyWork";
import {
  buildProjectTicketKanbanColumns,
  type ProjectTicketKanbanBoardColumn,
} from "~/t3work/t3work-projectTicketStatus";
import {
  buildAssignedWorkItems,
  buildProjectMyWorkDisplayColumns,
  buildVisibleMyWorkHierarchy,
  buildProjectKanbanColumnOptions,
  filterAndSortProjectMyWorkItems,
  normalizeHiddenKanbanColumnIds,
} from "~/t3work/hooks/t3work-projectKanbanDerivedData";
import type {
  ProjectMyWorkGroupMode,
  ProjectMyWorkTableSortBy,
  ProjectMyWorkTableSortDirection,
} from "~/t3work/t3work-projectDashboardMyWorkState";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function useProjectMyWorkDerivedData({
  tickets,
  identity,
  deferredQuery,
  statusCategory,
  excludedTypeKeys,
  hiddenKanbanColumnIds,
  selectedPriority,
  selectedStatus,
  tableSortBy,
  tableSortDirection,
  groupMode,
  boardColumns,
  kanbanProfileId,
}: {
  tickets: readonly ProjectTicket[];
  identity: ProjectMyWorkIdentity;
  deferredQuery: string;
  statusCategory: ProjectMyWorkStatusCategory;
  excludedTypeKeys: ReadonlyArray<string>;
  hiddenKanbanColumnIds: ReadonlyArray<string>;
  selectedPriority: string;
  selectedStatus: string;
  tableSortBy: ProjectMyWorkTableSortBy;
  tableSortDirection: ProjectMyWorkTableSortDirection;
  groupMode: ProjectMyWorkGroupMode;
  boardColumns?: ReadonlyArray<ProjectTicketKanbanBoardColumn>;
  kanbanProfileId?: string;
}) {
  const assignedWorkItems = useMemo(
    () => buildAssignedWorkItems(tickets, identity),
    [identity, tickets],
  );

  const preTypeFilterWorkItems = useMemo(() => {
    return filterAndSortProjectMyWorkItems({
      tickets,
      identity,
      query: deferredQuery,
      statusCategory,
      excludedTypeKeys: [],
      selectedPriority,
      selectedStatus,
      tableSortBy,
      tableSortDirection,
    });
  }, [
    deferredQuery,
    identity,
    selectedPriority,
    selectedStatus,
    statusCategory,
    tableSortBy,
    tableSortDirection,
    tickets,
  ]);

  const preTypeFilterVisibleHierarchy = useMemo(
    () =>
      buildVisibleMyWorkHierarchy(
        tickets,
        preTypeFilterWorkItems,
        tableSortBy,
        tableSortDirection,
        [],
      ),
    [preTypeFilterWorkItems, tableSortBy, tableSortDirection, tickets],
  );

  const { normalizedExcludedTypeKeys, typeOptions } = useMemo(() => {
    const typeOptions = buildProjectMyWorkTypeOptions(preTypeFilterVisibleHierarchy.visibleTickets);
    const validKeys = new Set(typeOptions.map((option) => option.key));
    return {
      typeOptions,
      normalizedExcludedTypeKeys: excludedTypeKeys.filter((key) => validKeys.has(key)),
    };
  }, [excludedTypeKeys, preTypeFilterVisibleHierarchy.visibleTickets]);

  const filteredWorkItems = useMemo(() => {
    return filterAndSortProjectMyWorkItems({
      tickets,
      identity,
      query: deferredQuery,
      statusCategory,
      excludedTypeKeys: normalizedExcludedTypeKeys,
      selectedPriority,
      selectedStatus,
      tableSortBy,
      tableSortDirection,
    });
  }, [
    deferredQuery,
    identity,
    normalizedExcludedTypeKeys,
    selectedPriority,
    selectedStatus,
    statusCategory,
    tableSortBy,
    tableSortDirection,
    tickets,
  ]);

  const visibleHierarchy = useMemo(
    () =>
      buildVisibleMyWorkHierarchy(
        tickets,
        filteredWorkItems,
        tableSortBy,
        tableSortDirection,
        normalizedExcludedTypeKeys,
      ),
    [filteredWorkItems, normalizedExcludedTypeKeys, tableSortBy, tableSortDirection, tickets],
  );

  const kanbanColumnOptions = useMemo(
    () => buildProjectKanbanColumnOptions(kanbanProfileId, boardColumns),
    [boardColumns, kanbanProfileId],
  );

  const { allKanbanColumns, kanbanLaneOptions, normalizedHiddenKanbanColumnIds } = useMemo(() => {
    const allKanbanColumns = buildProjectTicketKanbanColumns(
      filteredWorkItems,
      kanbanColumnOptions,
    );
    const kanbanLaneOptions = buildProjectMyWorkKanbanLaneOptions(allKanbanColumns);
    return {
      allKanbanColumns,
      kanbanLaneOptions,
      normalizedHiddenKanbanColumnIds: normalizeHiddenKanbanColumnIds(
        hiddenKanbanColumnIds,
        kanbanLaneOptions,
      ),
    };
  }, [filteredWorkItems, hiddenKanbanColumnIds, kanbanColumnOptions]);

  const kanbanVisibleWorkItems = useMemo(
    () =>
      filterProjectMyWorkKanbanTicketsByHiddenColumns(
        filteredWorkItems,
        normalizedHiddenKanbanColumnIds,
      ),
    [filteredWorkItems, normalizedHiddenKanbanColumnIds],
  );

  const kanbanColumns = useMemo(
    () => buildProjectTicketKanbanColumns(kanbanVisibleWorkItems, kanbanColumnOptions),
    [kanbanColumnOptions, kanbanVisibleWorkItems],
  );

  const kanbanVisibleHierarchy = useMemo(
    () =>
      buildVisibleMyWorkHierarchy(
        tickets,
        kanbanVisibleWorkItems,
        tableSortBy,
        tableSortDirection,
        normalizedExcludedTypeKeys,
      ),
    [kanbanVisibleWorkItems, normalizedExcludedTypeKeys, tableSortBy, tableSortDirection, tickets],
  );

  const kanbanDisplayColumns = useMemo(
    () =>
      buildProjectMyWorkDisplayColumns(
        groupMode,
        kanbanColumns,
        kanbanVisibleHierarchy,
        normalizedHiddenKanbanColumnIds,
      ),
    [groupMode, kanbanColumns, kanbanVisibleHierarchy, normalizedHiddenKanbanColumnIds],
  );

  return {
    assignedWorkItems,
    filteredWorkItems,
    visibleHierarchy,
    typeOptions,
    normalizedExcludedTypeKeys,
    kanbanLaneOptions,
    normalizedHiddenKanbanColumnIds,
    kanbanDisplayColumns,
    kanbanVisibleHierarchy,
  };
}
