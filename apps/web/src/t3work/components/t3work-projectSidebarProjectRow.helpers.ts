import type { ProjectTicket } from "~/t3work/t3work-types";
import { readLocalApi } from "~/localApi";
import { buildTicketSidebarPinnedItemId } from "~/t3work/t3work-sidebarPinningTypes";
import {
  filterHiddenSidebarItemsById,
  sortSidebarItemsByStoredOrderById,
} from "~/t3work/t3work-sidebarNavPreferences";
import type { TicketViewMode } from "./t3work-projectSidebarShared";

type TicketHierarchyLike = {
  roots: readonly ProjectTicket[];
  unresolvedChildren: readonly ProjectTicket[];
  childrenByParentId: ReadonlyMap<string, readonly ProjectTicket[]>;
};

type ProjectContextMenuInput = {
  clientX: number;
  clientY: number;
  projectId: string;
  projectTitle: string;
  onManageProjectRepositories: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onBeginRename: () => void;
};

export function buildProjectContextMenuItems() {
  return [
    { id: "rename", label: "Rename project" },
    { id: "manage-repositories", label: "Manage linked repositories" },
    { id: "delete", label: "Delete project", destructive: true },
  ] as const;
}

function countVisibleTicketTreeNodes(
  ticket: ProjectTicket,
  projectId: string,
  childrenByParentId: ReadonlyMap<string, readonly ProjectTicket[]>,
  hiddenItemIds: ReadonlySet<string>,
): number {
  const children = (childrenByParentId.get(ticket.id) ?? []).filter(
    (child) =>
      !hiddenItemIds.has(buildTicketSidebarPinnedItemId({ projectId, ticketId: child.id })),
  );
  return (
    1 +
    children.reduce(
      (count, child) =>
        count + countVisibleTicketTreeNodes(child, projectId, childrenByParentId, hiddenItemIds),
      0,
    )
  );
}

function getTicketSidebarItemId(projectId: string, ticket: ProjectTicket): string {
  return buildTicketSidebarPinnedItemId({ projectId, ticketId: ticket.id });
}

function filterAndSortTicketsForSidebar(input: {
  projectId: string;
  tickets: ReadonlyArray<ProjectTicket>;
  hiddenItemIds: ReadonlyArray<string>;
  orderedItemIds: ReadonlyArray<string>;
}): ProjectTicket[] {
  const { projectId, tickets, hiddenItemIds, orderedItemIds } = input;
  return sortSidebarItemsByStoredOrderById(
    filterHiddenSidebarItemsById(tickets, hiddenItemIds, (ticket) =>
      getTicketSidebarItemId(projectId, ticket),
    ),
    orderedItemIds,
    (ticket) => getTicketSidebarItemId(projectId, ticket),
  );
}

export function computeHiddenTicketCount(input: {
  projectId: string;
  ticketViewMode: TicketViewMode;
  projectTicketsLength: number;
  visibleFlatTicketsLength: number;
  visibleTreeRoots: ReadonlyArray<ProjectTicket>;
  visibleTreeUnresolvedChildrenLength: number;
  childrenByParentId: ReadonlyMap<string, readonly ProjectTicket[]>;
  hiddenItemIds: ReadonlyArray<string>;
}): number {
  if (input.ticketViewMode === "flat") {
    return Math.max(0, input.projectTicketsLength - input.visibleFlatTicketsLength);
  }
  const hiddenItemIdSet = new Set(input.hiddenItemIds);
  const visibleTreeCount =
    input.visibleTreeRoots.reduce(
      (count, ticket) =>
        count +
        countVisibleTicketTreeNodes(
          ticket,
          input.projectId,
          input.childrenByParentId,
          hiddenItemIdSet,
        ),
      0,
    ) + input.visibleTreeUnresolvedChildrenLength;
  return Math.max(0, input.projectTicketsLength - visibleTreeCount);
}

export async function showProjectContextMenu(input: ProjectContextMenuInput): Promise<void> {
  const api = readLocalApi();
  if (!api) return;

  const action = await api.contextMenu.show(buildProjectContextMenuItems(), {
    x: input.clientX,
    y: input.clientY,
  });

  if (action === "rename") {
    input.onBeginRename();
    return;
  }
  if (action === "manage-repositories") {
    input.onManageProjectRepositories(input.projectId);
    return;
  }
  if (action !== "delete") {
    return;
  }
  const confirmed = await api.dialogs.confirm(`Delete project "${input.projectTitle}"?`);
  if (confirmed) {
    input.onDeleteProject(input.projectId);
  }
}

export function deriveTicketVisibility(input: {
  projectId: string;
  projectTickets: readonly ProjectTicket[];
  ticketHierarchy: TicketHierarchyLike;
  ticketViewMode: TicketViewMode;
  hiddenItemIds: ReadonlyArray<string>;
  orderedItemIds: ReadonlyArray<string>;
}) {
  const visibleFlatTickets = filterAndSortTicketsForSidebar({
    projectId: input.projectId,
    tickets: input.projectTickets,
    hiddenItemIds: input.hiddenItemIds,
    orderedItemIds: input.orderedItemIds,
  }).slice(0, 5);
  const visibleTreeRoots = filterAndSortTicketsForSidebar({
    projectId: input.projectId,
    tickets: input.ticketHierarchy.roots,
    hiddenItemIds: input.hiddenItemIds,
    orderedItemIds: input.orderedItemIds,
  }).slice(0, 5);
  const availableSlots = Math.max(0, 5 - visibleTreeRoots.length);
  const visibleTreeUnresolvedChildren =
    availableSlots === 0
      ? ([] as readonly ProjectTicket[])
      : filterAndSortTicketsForSidebar({
          projectId: input.projectId,
          tickets: input.ticketHierarchy.unresolvedChildren,
          hiddenItemIds: input.hiddenItemIds,
          orderedItemIds: input.orderedItemIds,
        }).slice(0, availableSlots);

  const hiddenTicketCount = computeHiddenTicketCount({
    projectId: input.projectId,
    ticketViewMode: input.ticketViewMode,
    projectTicketsLength: input.projectTickets.length,
    visibleFlatTicketsLength: visibleFlatTickets.length,
    visibleTreeRoots,
    visibleTreeUnresolvedChildrenLength: visibleTreeUnresolvedChildren.length,
    childrenByParentId: input.ticketHierarchy.childrenByParentId,
    hiddenItemIds: input.hiddenItemIds,
  });

  return {
    visibleFlatTickets,
    visibleTreeRoots,
    visibleTreeUnresolvedChildren,
    hiddenTicketCount,
  };
}
