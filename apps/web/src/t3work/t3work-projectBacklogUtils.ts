import type { ProjectTicket } from "~/t3work/t3work-types";

export type ProjectBacklogFocusFilter = "all" | "needs-plan" | "unassigned" | "with-subtasks";

export const PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL = "__all__";
export const PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED = "__unassigned__";

export type ProjectBacklogAssigneeFilterOption = {
  readonly value: string;
  readonly label: string;
};

export function hasProjectBacklogAssignee(ticket: ProjectTicket): boolean {
  return Boolean(ticket.assigneeAccountId ?? ticket.assignee);
}

export function hasProjectBacklogEstimate(ticket: ProjectTicket): boolean {
  return typeof ticket.estimateValue === "number";
}

export function getProjectTicketIssueTypeKey(ticket: ProjectTicket): string {
  return (ticket.issueType ?? ticket.ref.type ?? "").trim().toLowerCase();
}

export function getProjectBacklogAssigneeFilterValue(ticket: ProjectTicket): string {
  if (ticket.assigneeAccountId?.trim()) {
    return `account:${ticket.assigneeAccountId}`;
  }

  if (ticket.assignee?.trim()) {
    return `name:${ticket.assignee.trim().toLowerCase()}`;
  }

  return PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED;
}

export function buildProjectBacklogAssigneeFilterOptions(
  tickets: readonly ProjectTicket[],
  preferredDisplayName?: string,
): ReadonlyArray<ProjectBacklogAssigneeFilterOption> {
  const byValue = new Map<string, ProjectBacklogAssigneeFilterOption>();
  const normalizedPreferredDisplayName = preferredDisplayName?.trim().toLocaleLowerCase();

  for (const ticket of tickets) {
    const value = getProjectBacklogAssigneeFilterValue(ticket);
    if (value === PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED) {
      byValue.set(PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED, {
        value: PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED,
        label: "Unassigned",
      });
      continue;
    }

    if (!byValue.has(value) && ticket.assignee?.trim()) {
      byValue.set(value, {
        value,
        label: ticket.assignee.trim(),
      });
    }
  }

  return [
    { value: PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL, label: "All assignees" },
    ...Array.from(byValue.values()).toSorted((left, right) => {
      const leftIsPreferred =
        normalizedPreferredDisplayName !== undefined &&
        left.label.trim().toLocaleLowerCase() === normalizedPreferredDisplayName;
      const rightIsPreferred =
        normalizedPreferredDisplayName !== undefined &&
        right.label.trim().toLocaleLowerCase() === normalizedPreferredDisplayName;
      if (leftIsPreferred !== rightIsPreferred) {
        return leftIsPreferred ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    }),
  ];
}

export function resolveProjectBacklogAssigneeFilter(
  tickets: readonly ProjectTicket[],
  assigneeFilter?: string,
): string {
  if (!assigneeFilter || assigneeFilter === PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL) {
    return PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL;
  }

  return tickets.some((ticket) => getProjectBacklogAssigneeFilterValue(ticket) === assigneeFilter)
    ? assigneeFilter
    : PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL;
}

export function isProjectTicketSubtask(ticket: ProjectTicket): boolean {
  if (ticket.issueTypeIsSubtask === true) {
    return true;
  }

  const issueType = getProjectTicketIssueTypeKey(ticket);
  return issueType.includes("subtask") || issueType.includes("sub-task");
}

export function isProjectTicketHourTracked(ticket: ProjectTicket): boolean {
  const issueType = getProjectTicketIssueTypeKey(ticket);
  if (issueType.length > 0) {
    if (issueType.includes("story")) {
      return false;
    }
    return issueType.includes("bug") || isProjectTicketSubtask(ticket);
  }

  if (
    ticket.timeOriginalEstimateSeconds !== undefined ||
    ticket.timeRemainingEstimateSeconds !== undefined ||
    ticket.aggregateTimeOriginalEstimateSeconds !== undefined ||
    ticket.aggregateTimeRemainingEstimateSeconds !== undefined
  ) {
    return true;
  }

  return false;
}

function matchesFocusFilter(
  ticket: ProjectTicket,
  focusFilter: ProjectBacklogFocusFilter,
): boolean {
  switch (focusFilter) {
    case "needs-plan":
      return !hasProjectBacklogAssignee(ticket) || !hasProjectBacklogEstimate(ticket);
    case "unassigned":
      return !hasProjectBacklogAssignee(ticket);
    case "with-subtasks":
      return (ticket.subtaskCount ?? 0) > 0;
    default:
      return true;
  }
}

function matchesAssigneeFilter(ticket: ProjectTicket, assigneeFilter: string): boolean {
  if (!assigneeFilter || assigneeFilter === PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL) {
    return true;
  }

  return getProjectBacklogAssigneeFilterValue(ticket) === assigneeFilter;
}

function buildProjectBacklogSearchHaystack(
  ticket: ProjectTicket,
  ticketById: ReadonlyMap<string, ProjectTicket>,
): string {
  const parts = [
    ticket.ref.displayId,
    ticket.ref.title,
    ticket.description ?? "",
    ticket.status,
    ticket.priority ?? "",
    ticket.assignee ?? "",
    ticket.issueType ?? ticket.ref.type ?? "",
    ticket.sprintName ?? "",
    ticket.sprintGoal ?? "",
  ];

  const visitedAncestorIds = new Set<string>();
  let currentParentId = ticket.parentId;

  while (currentParentId && !visitedAncestorIds.has(currentParentId)) {
    visitedAncestorIds.add(currentParentId);
    const parent = ticketById.get(currentParentId);
    if (!parent) {
      parts.push(currentParentId);
      break;
    }

    parts.push(parent.ref.displayId, parent.ref.title, parent.issueType ?? parent.ref.type ?? "");
    currentParentId = parent.parentId;
  }

  return parts.join(" ").toLowerCase();
}

export function compareProjectBacklogTickets(left: ProjectTicket, right: ProjectTicket): number {
  const scoreLeft =
    Number(!hasProjectBacklogEstimate(left)) * 2 + Number(!hasProjectBacklogAssignee(left));
  const scoreRight =
    Number(!hasProjectBacklogEstimate(right)) * 2 + Number(!hasProjectBacklogAssignee(right));
  const scoreDelta = scoreRight - scoreLeft;
  if (scoreDelta !== 0) return scoreDelta;

  const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (!Number.isNaN(updatedDelta) && updatedDelta !== 0) return updatedDelta;

  return left.ref.displayId.localeCompare(right.ref.displayId, undefined, { numeric: true });
}

export function filterProjectBacklogTickets({
  tickets,
  query,
  focusFilter,
  assigneeFilter = PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL,
}: {
  tickets: readonly ProjectTicket[];
  query: string;
  focusFilter: ProjectBacklogFocusFilter;
  assigneeFilter?: string;
}): ProjectTicket[] {
  const normalizedQuery = query.trim().toLowerCase();
  const resolvedAssigneeFilter = resolveProjectBacklogAssigneeFilter(tickets, assigneeFilter);
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .filter((ticket) => matchesFocusFilter(ticket, focusFilter))
    .filter((ticket) => matchesAssigneeFilter(ticket, resolvedAssigneeFilter))
    .filter((ticket) => {
      if (!normalizedQuery) return true;
      const haystack = buildProjectBacklogSearchHaystack(ticket, ticketById);
      return haystack.includes(normalizedQuery);
    })
    .toSorted(compareProjectBacklogTickets);
}

export function summarizeProjectBacklog(tickets: readonly ProjectTicket[]) {
  return {
    total: tickets.length,
    needsPlan: tickets.filter(
      (ticket) => !hasProjectBacklogAssignee(ticket) || !hasProjectBacklogEstimate(ticket),
    ).length,
    unassigned: tickets.filter((ticket) => !hasProjectBacklogAssignee(ticket)).length,
    needsEstimate: tickets.filter((ticket) => !hasProjectBacklogEstimate(ticket)).length,
    ready: tickets.filter(
      (ticket) => hasProjectBacklogAssignee(ticket) && hasProjectBacklogEstimate(ticket),
    ).length,
    withSubtasks: tickets.filter((ticket) => (ticket.subtaskCount ?? 0) > 0).length,
  };
}
