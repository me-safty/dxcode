import { describe, expect, it } from "vitest";

import {
  resolveProjectDashboardMyWorkState,
  type PersistedProjectDashboardMyWorkState,
  type ProjectDashboardMyWorkRouteSearch,
} from "~/t3work/t3work-projectDashboardMyWorkState";

describe("project dashboard my work state", () => {
  it("defaults to kanban view with no hidden lanes", () => {
    expect(resolveProjectDashboardMyWorkState({})).toEqual({
      query: "",
      viewMode: "kanban",
      groupMode: "hierarchy",
      statusCategory: "all",
      showGitHubActivity: true,
      hiddenKanbanColumnIds: [],
      excludedTypeKeys: [],
      selectedPriority: "all",
      selectedStatus: "all",
      tableSortBy: "updated",
      tableSortDirection: "desc",
    });
  });

  it("merges persisted state with route search overrides", () => {
    const persisted: PersistedProjectDashboardMyWorkState = {
      query: "persisted query",
      viewMode: "grid",
      groupMode: "flat",
      statusCategory: "review",
      showGitHubActivity: false,
      hiddenKanbanColumnIds: ["accepted"],
      excludedTypeKeys: ["bug"],
      selectedPriority: "High",
      selectedStatus: "In Review",
      tableSortBy: "status",
      tableSortDirection: "asc",
    };
    const search: ProjectDashboardMyWorkRouteSearch = {
      myWorkQ: "route query",
      myWorkView: "table",
      myWorkGroup: "hierarchy",
      myWorkStatus: "active",
      myWorkGitHub: "show",
      myWorkLanes: "in-test,accepted",
      myWorkPriority: "Critical",
      myWorkTicketStatus: "In Progress",
      myWorkTypes: "epic,story",
      myWorkSort: "updated",
      myWorkDir: "desc",
    };

    expect(resolveProjectDashboardMyWorkState({ persisted, search })).toEqual({
      query: "route query",
      viewMode: "table",
      groupMode: "hierarchy",
      statusCategory: "active",
      showGitHubActivity: true,
      hiddenKanbanColumnIds: ["accepted", "in-test"],
      excludedTypeKeys: ["epic", "story"],
      selectedPriority: "Critical",
      selectedStatus: "In Progress",
      tableSortBy: "updated",
      tableSortDirection: "desc",
    });
  });
});
