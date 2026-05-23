import type { BacklogSelectionInput } from "./hooks/t3work-projectBacklogCache";
import {
  projectBacklogViewModes,
  type ProjectBacklogViewMode,
} from "./t3work-projectBacklogPresentation";
import type {
  ProjectBacklogTableColumnId,
  ProjectBacklogTableGroupBy,
  ProjectBacklogTableSortBy,
  ProjectBacklogTableSortDirection,
} from "./t3work-projectBacklogTable";
import {
  defaultProjectBacklogTableVisibleColumns,
  projectBacklogTableColumnValues,
} from "./t3work-projectBacklogTable";
import {
  PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL,
  type ProjectBacklogFocusFilter,
} from "./t3work-projectBacklogUtils";

export interface ProjectDashboardBacklogRouteSearch {
  q?: string;
  focus?: ProjectBacklogFocusFilter;
  assignee?: string;
  view?: ProjectBacklogViewMode;
  group?: ProjectBacklogTableGroupBy;
  sort?: ProjectBacklogTableSortBy;
  dir?: ProjectBacklogTableSortDirection;
  board?: string;
  sprint?: string;
  jiraFilter?: string;
}

export interface ProjectDashboardBacklogState extends BacklogSelectionInput {
  query: string;
  focusFilter: ProjectBacklogFocusFilter;
  assigneeFilter: string;
  viewMode: ProjectBacklogViewMode;
  tableGroupBy: ProjectBacklogTableGroupBy;
  tableSortBy: ProjectBacklogTableSortBy;
  tableSortDirection: ProjectBacklogTableSortDirection;
  visibleTableColumns: ReadonlyArray<ProjectBacklogTableColumnId>;
}

export type PersistedProjectDashboardBacklogState = Partial<ProjectDashboardBacklogState>;

export const EMPTY_BOARD_ROUTE_SEARCH_VALUE = "__no_board__";
export const ALL_SPRINTS_ROUTE_SEARCH_VALUE = "__all_sprints__";
export const ALL_JIRA_FILTERS_ROUTE_SEARCH_VALUE = "__all_saved_filters__";

export const projectBacklogFocusFilterValues = new Set<ProjectBacklogFocusFilter>([
  "all",
  "needs-plan",
  "unassigned",
  "with-subtasks",
]);
export const projectBacklogViewModeValues = new Set<ProjectBacklogViewMode>([
  "hierarchy",
  "planning",
  "ownership",
  "table",
]);
export const projectBacklogTableGroupByValues = new Set<ProjectBacklogTableGroupBy>([
  "planning-state",
  "sprint",
  "assignee",
  "status",
  "issue-type",
  "parent",
]);
export const projectBacklogTableSortByValues = new Set<ProjectBacklogTableSortBy>([
  "rank",
  "updated",
  "estimate",
  "key",
  "title",
  "status",
  "assignee",
]);
export const projectBacklogTableSortDirectionValues = new Set<ProjectBacklogTableSortDirection>([
  "asc",
  "desc",
]);

export function parseVisibleProjectBacklogTableColumns(
  value: unknown,
): ReadonlyArray<ProjectBacklogTableColumnId> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value.filter(
    (column): column is ProjectBacklogTableColumnId =>
      typeof column === "string" &&
      projectBacklogTableColumnValues.has(column as ProjectBacklogTableColumnId),
  );

  const deduped = [...new Set(parsed)];
  return deduped.length > 0 ? deduped : undefined;
}

export const routeSearchKeys = [
  "q",
  "focus",
  "assignee",
  "view",
  "group",
  "sort",
  "dir",
  "board",
  "sprint",
  "jiraFilter",
] as const;

function normalizeRouteString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().length > 0 ? value.trim() : undefined;
}

export function parseRouteEnum<TValue extends string>(
  value: unknown,
  allowedValues: ReadonlySet<TValue>,
): TValue | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return allowedValues.has(value as TValue) ? (value as TValue) : undefined;
}

export function parsePersistedSelection(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function createDefaultProjectDashboardBacklogState(): ProjectDashboardBacklogState {
  return {
    query: "",
    focusFilter: "all",
    assigneeFilter: PROJECT_BACKLOG_ASSIGNEE_FILTER_ALL,
    viewMode: projectBacklogViewModes[0]?.value ?? "table",
    tableGroupBy: "planning-state",
    tableSortBy: "rank",
    tableSortDirection: "desc",
    visibleTableColumns: [...defaultProjectBacklogTableVisibleColumns],
  };
}

export function getProjectDashboardBacklogStorageKey(projectId: string): string {
  return `t3work:project-backlog-state:v1:${projectId}`;
}

export function parseProjectDashboardBacklogRouteSearch(
  search: Record<string, unknown>,
): ProjectDashboardBacklogRouteSearch {
  const parsed: ProjectDashboardBacklogRouteSearch = {};

  if (typeof search.q === "string") {
    parsed.q = search.q;
  }

  const focus = parseRouteEnum(search.focus, projectBacklogFocusFilterValues);
  if (focus !== undefined) {
    parsed.focus = focus;
  }

  if (typeof search.assignee === "string") {
    parsed.assignee = search.assignee;
  }

  const view = parseRouteEnum(search.view, projectBacklogViewModeValues);
  if (view !== undefined) {
    parsed.view = view;
  }

  const group = parseRouteEnum(search.group, projectBacklogTableGroupByValues);
  if (group !== undefined) {
    parsed.group = group;
  }

  const sort = parseRouteEnum(search.sort, projectBacklogTableSortByValues);
  if (sort !== undefined) {
    parsed.sort = sort;
  }

  const dir = parseRouteEnum(search.dir, projectBacklogTableSortDirectionValues);
  if (dir !== undefined) {
    parsed.dir = dir;
  }

  const board = normalizeRouteString(search.board);
  if (board !== undefined) {
    parsed.board = board;
  }

  const sprint = normalizeRouteString(search.sprint);
  if (sprint !== undefined) {
    parsed.sprint = sprint;
  }

  const jiraFilter = normalizeRouteString(search.jiraFilter);
  if (jiraFilter !== undefined) {
    parsed.jiraFilter = jiraFilter;
  }

  return parsed;
}
