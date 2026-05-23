import {
  resolveT3WorkProjectSetupProfileId,
  type T3WorkProjectSetupProfileId,
} from "~/t3work/t3work-projectSetup";
import type { ProjectTicket } from "~/t3work/t3work-types";
import {
  doneStatusKeywords,
  formatProjectTicketKanbanStatusTitle,
  inProgressStatusKeywords,
  includesStatusKeyword,
  normalizeProjectTicketStatus,
  requirementsEngineerOnlyStatusKeywords,
  reviewStatusKeywords,
  todoStatusKeywords,
} from "~/t3work/t3work-projectTicketStatusKeywords";

export type ProjectTicketStatusCategory = "active" | "review" | "done";
export type ProjectTicketKanbanColumnId = string;
export type ProjectTicketKanbanColumn = {
  id: ProjectTicketKanbanColumnId;
  title: string;
  items: ProjectTicket[];
};
export type ProjectTicketKanbanColumns = readonly ProjectTicketKanbanColumn[];
export type ProjectTicketKanbanBoardColumn = {
  readonly name: string;
  readonly statuses: ReadonlyArray<{
    readonly name: string;
  }>;
};

export function getProjectTicketKanbanColumnId(status: string): ProjectTicketKanbanColumnId {
  const normalizedStatus = normalizeProjectTicketStatus(status);
  return normalizedStatus.length > 0 ? normalizedStatus : "__no_status__";
}

export function isProjectTicketKanbanStatusVisibleForProfile(
  status: string,
  profileId?: string,
): boolean {
  const normalizedStatus = normalizeProjectTicketStatus(status);
  if (normalizedStatus.length === 0) return true;

  if (!profileId) {
    return true;
  }

  const resolvedProfileId = resolveT3WorkProjectSetupProfileId(profileId);
  if (resolvedProfileId === "requirements-engineer" || resolvedProfileId === "project-partner") {
    return true;
  }

  return !includesStatusKeyword(normalizedStatus, requirementsEngineerOnlyStatusKeywords);
}

export function getProjectTicketKanbanLane(
  status: string,
): "todo" | "inProgress" | "review" | "done" {
  const normalizedStatus = normalizeProjectTicketStatus(status);
  if (normalizedStatus.length === 0) return "todo";

  if (includesStatusKeyword(normalizedStatus, doneStatusKeywords)) {
    return "done";
  }

  if (includesStatusKeyword(normalizedStatus, reviewStatusKeywords)) {
    return "review";
  }

  if (includesStatusKeyword(normalizedStatus, todoStatusKeywords)) {
    return "todo";
  }

  if (includesStatusKeyword(normalizedStatus, inProgressStatusKeywords)) {
    return "inProgress";
  }

  return "todo";
}

export function matchesProjectTicketStatusCategory(
  status: string,
  category: ProjectTicketStatusCategory,
): boolean {
  const lane = getProjectTicketKanbanLane(status);
  if (category === "active") {
    return lane === "todo" || lane === "inProgress";
  }

  return lane === category;
}

export function getProjectTicketKanbanLaneRank(status: string): number {
  switch (getProjectTicketKanbanLane(status)) {
    case "inProgress":
      return 0;
    case "review":
      return 1;
    case "todo":
      return 2;
    case "done":
      return 3;
  }
}

function buildProjectTicketKanbanConfiguredStatusOrder(
  boardColumns?: ReadonlyArray<ProjectTicketKanbanBoardColumn>,
): ReadonlyMap<string, number> {
  const configuredStatusOrder = new Map<string, number>();
  let nextOrder = 0;

  for (const column of boardColumns ?? []) {
    for (const status of column.statuses) {
      const normalizedStatus = normalizeProjectTicketStatus(status.name);
      if (normalizedStatus.length === 0 || configuredStatusOrder.has(normalizedStatus)) {
        continue;
      }

      configuredStatusOrder.set(normalizedStatus, nextOrder);
      nextOrder += 1;
    }
  }

  return configuredStatusOrder;
}

function isProjectTicketKanbanStatusVisibleOnBoard(
  status: string,
  configuredStatusOrder: ReadonlyMap<string, number>,
): boolean {
  if (configuredStatusOrder.size === 0) {
    return true;
  }

  return configuredStatusOrder.has(normalizeProjectTicketStatus(status));
}

function getProjectTicketKanbanColumnOrder(
  status: string,
  configuredStatusOrder?: ReadonlyMap<string, number>,
): number {
  const normalizedStatus = normalizeProjectTicketStatus(status);
  const configuredOrder = normalizedStatus
    ? configuredStatusOrder?.get(normalizedStatus)
    : undefined;
  if (configuredOrder !== undefined) {
    return configuredOrder;
  }

  const fallbackBase = (configuredStatusOrder?.size ?? 0) + 100;
  switch (getProjectTicketKanbanLane(status)) {
    case "todo":
      return fallbackBase + 0;
    case "inProgress":
      return fallbackBase + 1;
    case "review":
      return fallbackBase + 2;
    case "done":
      return fallbackBase + 3;
  }
}

export function buildProjectTicketKanbanColumns(
  tickets: readonly ProjectTicket[],
  options?: {
    profileId?: T3WorkProjectSetupProfileId | string;
    boardColumns?: ReadonlyArray<ProjectTicketKanbanBoardColumn>;
  },
): ProjectTicketKanbanColumns {
  const columnsById = new Map<ProjectTicketKanbanColumnId, ProjectTicketKanbanColumn>();
  const configuredStatusOrder = buildProjectTicketKanbanConfiguredStatusOrder(
    options?.boardColumns,
  );

  for (const ticket of tickets) {
    if (!isProjectTicketKanbanStatusVisibleForProfile(ticket.status, options?.profileId)) {
      continue;
    }

    if (!isProjectTicketKanbanStatusVisibleOnBoard(ticket.status, configuredStatusOrder)) {
      continue;
    }

    const id = getProjectTicketKanbanColumnId(ticket.status);
    const existingColumn = columnsById.get(id);
    if (existingColumn) {
      existingColumn.items.push(ticket);
      continue;
    }

    columnsById.set(id, {
      id,
      title: formatProjectTicketKanbanStatusTitle(ticket.status),
      items: [ticket],
    });
  }

  return [...columnsById.values()].toSorted((left, right) => {
    const orderDifference =
      getProjectTicketKanbanColumnOrder(left.title, configuredStatusOrder) -
      getProjectTicketKanbanColumnOrder(right.title, configuredStatusOrder);
    return orderDifference !== 0 ? orderDifference : left.title.localeCompare(right.title);
  });
}
