import type { ProjectTicket } from "~/t3work/t3work-types";

export const PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL = "__all__";
export const PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED = "__unassigned__";

export type ProjectBacklogAssigneeFilterOption = {
  readonly value: string;
  readonly label: string;
};

export type ProjectBacklogAssigneeFilterScopeKey = "epic" | "story" | "subtask";
export type ProjectBacklogIssueTypeFilterKey = "epic" | "standard" | "subtask";

export type ProjectBacklogAssigneeFilterScope = Record<
  ProjectBacklogAssigneeFilterScopeKey,
  boolean
>;

export const defaultProjectBacklogAssigneeFilterScope: ProjectBacklogAssigneeFilterScope = {
  epic: false,
  story: true,
  subtask: false,
};

export const projectBacklogAssigneeFilterScopeOptions: ReadonlyArray<{
  readonly value: ProjectBacklogAssigneeFilterScopeKey;
  readonly label: string;
}> = [
  { value: "epic", label: "Epics" },
  { value: "story", label: "Stories" },
  { value: "subtask", label: "Subtasks" },
];

export const projectBacklogIssueTypeFilterOptions: ReadonlyArray<{
  readonly value: ProjectBacklogIssueTypeFilterKey;
  readonly label: string;
}> = [
  { value: "epic", label: "Epics" },
  { value: "standard", label: "Stories/tasks" },
  { value: "subtask", label: "Subtasks" },
];

export const defaultProjectBacklogVisibleIssueTypes: ReadonlyArray<ProjectBacklogIssueTypeFilterKey> =
  ["epic", "standard", "subtask"];

export function getProjectBacklogAssigneeFilterValue(ticket: ProjectTicket): string {
  if (ticket.assigneeAccountId?.trim()) {
    return `account:${ticket.assigneeAccountId}`;
  }

  if (ticket.assignee?.trim()) {
    return `name:${ticket.assignee.trim().toLowerCase()}`;
  }

  return PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED;
}

export function normalizeProjectBacklogAssigneeName(name: string | undefined): string | undefined {
  const normalized = name?.trim().toLocaleLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function buildProjectBacklogAssigneeFilterOptions(
  tickets: readonly ProjectTicket[],
  preferredDisplayName?: string,
): ReadonlyArray<ProjectBacklogAssigneeFilterOption> {
  const byName = new Map<string, ProjectBacklogAssigneeFilterOption>();
  const byValue = new Set<string>();
  const normalizedPreferredDisplayName = normalizeProjectBacklogAssigneeName(preferredDisplayName);

  for (const ticket of tickets) {
    const value = getProjectBacklogAssigneeFilterValue(ticket);
    if (value === PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED) {
      byName.set(PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED, {
        value: PROJECT_BACKLOG_ASSIGNEE_FILTER_UNASSIGNED,
        label: "Unassigned",
      });
      continue;
    }

    const label = ticket.assignee?.trim();
    const normalizedName = normalizeProjectBacklogAssigneeName(label);
    if (!label || !normalizedName || byValue.has(value)) {
      continue;
    }

    byValue.add(value);
    const existing = byName.get(normalizedName);
    if (!existing || value.startsWith("account:")) {
      byName.set(normalizedName, {
        value,
        label,
      });
    }
  }

  return [
    { value: PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL, label: "All assignees" },
    ...Array.from(byName.values()).toSorted((left, right) => {
      const leftIsPreferred =
        normalizedPreferredDisplayName !== undefined &&
        normalizeProjectBacklogAssigneeName(left.label) === normalizedPreferredDisplayName;
      const rightIsPreferred =
        normalizedPreferredDisplayName !== undefined &&
        normalizeProjectBacklogAssigneeName(right.label) === normalizedPreferredDisplayName;
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
