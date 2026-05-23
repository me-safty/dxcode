import { describe, expect, it } from "vitest";

import {
  buildProjectSidebarRouteSearch,
  createDefaultProjectSidebarState,
  parseProjectSidebarRouteSearch,
  resolveProjectSidebarState,
  stripProjectSidebarSearchParams,
} from "./t3work-projectSidebarState";

describe("project sidebar state", () => {
  it("lets query params override persisted sidebar state including explicit false values", () => {
    const persisted = {
      projectSortOrder: "created_at",
      threadSortOrder: "created_at",
      threadPreviewCount: 9,
      ticketViewMode: "flat",
      showProjectThreads: true,
      showJiraItems: true,
      showGitHubActivity: true,
    } as const;

    const search = parseProjectSidebarRouteSearch({
      navProjectSort: "updated_at",
      navThreadCount: "3",
      navTicketView: "tree",
      navThreads: "0",
      navJira: "0",
      navGitHub: "1",
    });

    expect(resolveProjectSidebarState({ persisted, search })).toEqual({
      projectSortOrder: "updated_at",
      threadSortOrder: "created_at",
      threadPreviewCount: 3,
      ticketViewMode: "tree",
      showProjectThreads: false,
      showJiraItems: false,
      showGitHubActivity: true,
    });
  });

  it("builds deterministic route search values from the current sidebar state", () => {
    expect(
      buildProjectSidebarRouteSearch({
        ...createDefaultProjectSidebarState(),
        projectSortOrder: "created_at",
        threadSortOrder: "created_at",
        threadPreviewCount: 7,
        ticketViewMode: "flat",
        showProjectThreads: false,
        showJiraItems: true,
        showGitHubActivity: false,
      }),
    ).toEqual({
      navProjectSort: "created_at",
      navThreadSort: "created_at",
      navThreadCount: 7,
      navTicketView: "flat",
      navThreads: false,
      navJira: true,
      navGitHub: false,
    });
  });

  it("strips sidebar query params while preserving unrelated search params", () => {
    expect(
      stripProjectSidebarSearchParams({
        navProjectSort: "updated_at",
        navThreadSort: "created_at",
        navJira: true,
        unrelated: "keep-me",
      }),
    ).toEqual({ unrelated: "keep-me" });
  });
});
