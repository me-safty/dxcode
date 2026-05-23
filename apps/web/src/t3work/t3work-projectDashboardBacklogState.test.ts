import { describe, expect, it } from "vitest";

import {
  ALL_JIRA_FILTERS_ROUTE_SEARCH_VALUE,
  ALL_SPRINTS_ROUTE_SEARCH_VALUE,
  EMPTY_BOARD_ROUTE_SEARCH_VALUE,
  buildProjectDashboardBacklogRouteSearch,
  createDefaultProjectDashboardBacklogState,
  parseProjectDashboardBacklogRouteSearch,
  resolveProjectDashboardBacklogState,
  stripProjectDashboardBacklogSearchParams,
} from "./t3work-projectDashboardBacklogState";

describe("project dashboard backlog state", () => {
  it("lets query params override persisted state including explicit reset values", () => {
    const persisted = {
      query: "persisted query",
      focusFilter: "needs-plan",
      assigneeFilter: "account-1",
      viewMode: "table",
      tableGroupBy: "assignee",
      tableSortBy: "title",
      tableSortDirection: "asc",
      visibleTableColumns: ["status", "parent", "subtasks"],
      boardId: "board-2",
      sprintId: "sprint-9",
      filterId: "filter-4",
    } as const;

    const search = parseProjectDashboardBacklogRouteSearch({
      q: "",
      focus: "all",
      sprint: ALL_SPRINTS_ROUTE_SEARCH_VALUE,
      jiraFilter: ALL_JIRA_FILTERS_ROUTE_SEARCH_VALUE,
      board: "board-1",
      view: "planning",
    });

    expect(resolveProjectDashboardBacklogState({ persisted, search })).toEqual({
      query: "",
      focusFilter: "all",
      assigneeFilter: "account-1",
      viewMode: "planning",
      tableGroupBy: "assignee",
      tableSortBy: "title",
      tableSortDirection: "asc",
      visibleTableColumns: ["status", "parent", "subtasks"],
      boardId: "board-1",
      sprintId: undefined,
      filterId: undefined,
    });
  });

  it("builds deterministic route search values from the current backlog state", () => {
    expect(
      buildProjectDashboardBacklogRouteSearch({
        ...createDefaultProjectDashboardBacklogState(),
        query: "owner:alex",
        boardId: undefined,
        sprintId: undefined,
        filterId: "filter-7",
      }),
    ).toEqual({
      q: "owner:alex",
      focus: "all",
      assignee: "__all__",
      view: "table",
      group: "planning-state",
      sort: "rank",
      dir: "desc",
      board: EMPTY_BOARD_ROUTE_SEARCH_VALUE,
      sprint: ALL_SPRINTS_ROUTE_SEARCH_VALUE,
      jiraFilter: "filter-7",
    });
  });

  it("strips backlog query params while preserving unrelated search params", () => {
    expect(
      stripProjectDashboardBacklogSearchParams({
        q: "hello",
        focus: "all",
        board: "board-1",
        jiraFilter: "filter-3",
        unrelated: "keep-me",
      }),
    ).toEqual({ unrelated: "keep-me" });
  });

  it("normalizes persisted visible columns by keeping unique valid values", () => {
    expect(
      resolveProjectDashboardBacklogState({
        persisted: {
          visibleTableColumns: ["status", "unknown", "status"] as never,
        },
      }),
    ).toEqual({
      ...createDefaultProjectDashboardBacklogState(),
      visibleTableColumns: ["status"],
    });
  });
});
