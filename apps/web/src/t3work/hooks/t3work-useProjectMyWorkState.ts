import { useCallback, useDeferredValue, useMemo } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";

import { useAtlassianCurrentUserDisplayName } from "~/t3work/hooks/t3work-useAtlassianCurrentUserDisplayName";
import { readProjectSetupProfileIdFromProject } from "~/t3work/hooks/t3work-createProjectBootstrap";
import { useProjectMyWorkDerivedData } from "~/t3work/hooks/t3work-useProjectMyWorkDerivedData";
import { useProjectKanbanBoardColumns } from "~/t3work/hooks/t3work-useProjectKanbanBoardColumns";
import { useProjectResources } from "~/t3work/hooks/t3work-useProjectResources";
import { type ProjectMyWorkStatusCategory } from "~/t3work/t3work-projectMyWork";
import {
  useProjectDashboardMyWorkState,
  type ProjectMyWorkTableSortBy,
  type ProjectMyWorkTableSortDirection,
  type ProjectMyWorkViewMode,
} from "~/t3work/t3work-projectDashboardMyWorkState";
import { matchesProjectTicketStatusCategory } from "~/t3work/t3work-projectTicketStatus";
import type { ProjectTicket } from "~/t3work/t3work-types";

function buildDistinctOptions(values: ReadonlyArray<string | undefined>): string[] {
  const distinct = new Set<string>();

  for (const value of values) {
    const nextValue = value?.trim();
    if (nextValue) {
      distinct.add(nextValue);
    }
  }

  return [...distinct].toSorted((left, right) => left.localeCompare(right));
}

function countMatchingStatusCategory(
  tickets: readonly ProjectTicket[],
  category: "active" | "review" | "done",
) {
  return tickets.filter((ticket) => matchesProjectTicketStatusCategory(ticket.status, category))
    .length;
}

export function useProjectMyWorkState({
  project,
  fallbackTickets,
}: {
  project: ProjectShellProject;
  fallbackTickets: ProjectTicket[];
}) {
  const currentUserDisplayName = useAtlassianCurrentUserDisplayName(project.source.accountId);
  const { tickets: fetchedTickets, lastCheckedAt, reload } = useProjectResources(project);
  const { boardColumns } = useProjectKanbanBoardColumns(project);
  const tickets = fetchedTickets.length > 0 ? fetchedTickets : fallbackTickets;
  const kanbanProfileId = useMemo(() => readProjectSetupProfileIdFromProject(project), [project]);
  const identity = useMemo(
    () => ({
      ...(project.source.accountId ? { accountId: project.source.accountId } : {}),
      ...(currentUserDisplayName ? { displayName: currentUserDisplayName } : {}),
    }),
    [currentUserDisplayName, project.source.accountId],
  );

  const { state, setState } = useProjectDashboardMyWorkState(project.id);
  const {
    query,
    viewMode,
    groupMode,
    statusCategory,
    showGitHubActivity,
    hiddenKanbanColumnIds,
    excludedTypeKeys,
    selectedPriority,
    selectedStatus,
    tableSortBy,
    tableSortDirection,
  } = state;
  const deferredQuery = useDeferredValue(query);
  const updateState = useCallback(
    (partial: Partial<typeof state>) => {
      setState((current) => ({ ...current, ...partial }));
    },
    [setState],
  );

  const {
    assignedWorkItems,
    filteredWorkItems,
    visibleHierarchy,
    typeOptions,
    normalizedExcludedTypeKeys,
    kanbanLaneOptions,
    normalizedHiddenKanbanColumnIds,
    kanbanDisplayColumns,
    kanbanVisibleHierarchy,
  } = useProjectMyWorkDerivedData({
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
  });

  return {
    tickets,
    reloadTickets: reload,
    currentUserDisplayName,
    jiraLastCheckedAt: lastCheckedAt,
    query,
    setQuery: (value: string) => updateState({ query: value }),
    viewMode,
    setViewMode: (value: ProjectMyWorkViewMode) => updateState({ viewMode: value }),
    groupMode,
    setGroupMode: (value: "flat" | "hierarchy") => updateState({ groupMode: value }),
    statusCategory,
    setStatusCategory: (value: ProjectMyWorkStatusCategory) =>
      updateState({ statusCategory: value }),
    showGitHubActivity,
    setShowGitHubActivity: (value: boolean) => updateState({ showGitHubActivity: value }),
    hiddenKanbanColumnIds: normalizedHiddenKanbanColumnIds,
    toggleKanbanLaneVisibility: (columnId: string, visible: boolean) => {
      setState((current) => {
        const next = new Set(current.hiddenKanbanColumnIds);
        if (visible) {
          next.delete(columnId);
        } else {
          next.add(columnId);
        }
        return { ...current, hiddenKanbanColumnIds: [...next].toSorted() };
      });
    },
    excludedTypeKeys: normalizedExcludedTypeKeys,
    setExcludedTypeKeys: (value: string[]) => updateState({ excludedTypeKeys: value }),
    epicsHidden: normalizedExcludedTypeKeys.includes("epic"),
    setEpicsHidden: (hidden: boolean) => {
      setState((current) => {
        const next = new Set(current.excludedTypeKeys);
        if (hidden) {
          next.add("epic");
        } else {
          next.delete("epic");
        }
        return { ...current, excludedTypeKeys: [...next].toSorted() };
      });
    },
    toggleTypeVisibility: (typeKey: string, visible: boolean) => {
      setState((current) => {
        const next = new Set(current.excludedTypeKeys);
        if (visible) {
          next.delete(typeKey);
        } else {
          next.add(typeKey);
        }
        return { ...current, excludedTypeKeys: [...next].toSorted() };
      });
    },
    selectedPriority,
    setSelectedPriority: (value: string) => updateState({ selectedPriority: value }),
    priorityOptions: buildDistinctOptions(assignedWorkItems.map((ticket) => ticket.priority)),
    selectedStatus,
    setSelectedStatus: (value: string) => updateState({ selectedStatus: value }),
    statusOptions: buildDistinctOptions(assignedWorkItems.map((ticket) => ticket.status)),
    typeOptions,
    kanbanLaneOptions,
    tableSortBy,
    setTableSortBy: (value: ProjectMyWorkTableSortBy) => updateState({ tableSortBy: value }),
    tableSortDirection,
    setTableSortDirection: (value: ProjectMyWorkTableSortDirection) =>
      updateState({ tableSortDirection: value }),
    activeOptionsCount:
      Number(!showGitHubActivity) +
      Number(statusCategory !== "all") +
      Number(selectedPriority !== "all") +
      Number(selectedStatus !== "all") +
      normalizedHiddenKanbanColumnIds.length +
      normalizedExcludedTypeKeys.length,
    resetOptionsFilters: () => {
      updateState({
        showGitHubActivity: true,
        statusCategory: "all",
        hiddenKanbanColumnIds: [],
        excludedTypeKeys: [],
        selectedPriority: "all",
        selectedStatus: "all",
      });
    },
    assignedWorkItems,
    filteredWorkItems,
    visibleHierarchy,
    visibleContextCount: Math.max(
      0,
      visibleHierarchy.visibleTickets.length - filteredWorkItems.length,
    ),
    metrics: {
      total: assignedWorkItems.length,
      active: countMatchingStatusCategory(assignedWorkItems, "active"),
      review: countMatchingStatusCategory(assignedWorkItems, "review"),
      done: countMatchingStatusCategory(assignedWorkItems, "done"),
    },
    kanbanColumns: kanbanDisplayColumns,
    parentChildGroups: kanbanVisibleHierarchy.hierarchy,
  };
}
