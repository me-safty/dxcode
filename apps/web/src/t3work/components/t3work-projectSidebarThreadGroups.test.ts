import { describe, expect, it } from "vitest";

import { buildProjectSidebarThreadGroups } from "./t3work-projectSidebarThreadGroups";
import type { ProjectThread } from "~/t3work/t3work-types";

function makeThread(overrides: Partial<ProjectThread> = {}): ProjectThread {
  return {
    id: overrides.id ?? "thread-1",
    projectId: overrides.projectId ?? "project-1",
    title: overrides.title ?? "Thread",
    status: overrides.status ?? "idle",
    messageCount: overrides.messageCount ?? 0,
    lastMessageAt: overrides.lastMessageAt ?? "2026-05-22T10:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-05-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildProjectSidebarThreadGroups", () => {
  it("partitions project, dashboard, and ticket-owned threads", () => {
    const projectThread = makeThread({ id: "project-thread" });
    const backlogThread = makeThread({ id: "backlog-thread", dashboardMode: "backlog" });
    const myWorkThread = makeThread({ id: "my-work-thread", dashboardMode: "my-work" });
    const ticketThread = makeThread({ id: "ticket-thread", ticketId: "ticket-1" });

    const groups = buildProjectSidebarThreadGroups([
      projectThread,
      backlogThread,
      myWorkThread,
      ticketThread,
    ]);

    expect(groups.projectLevelThreads).toEqual([projectThread]);
    expect(groups.dashboardThreadsByMode.backlog).toEqual([backlogThread]);
    expect(groups.dashboardThreadsByMode["my-work"]).toEqual([myWorkThread]);
    expect(groups.ticketThreadsById.get("ticket-1")).toEqual([ticketThread]);
  });

  it("promotes threads for hidden tickets into the project root bucket", () => {
    const projectThread = makeThread({ id: "project-thread" });
    const visibleTicketThread = makeThread({ id: "visible-ticket-thread", ticketId: "ticket-1" });
    const hiddenTicketThread = makeThread({ id: "hidden-ticket-thread", ticketId: "ticket-2" });

    const groups = buildProjectSidebarThreadGroups(
      [projectThread, visibleTicketThread, hiddenTicketThread],
      { visibleTicketIds: new Set(["ticket-1"]) },
    );

    expect(groups.projectLevelThreads).toEqual([projectThread, hiddenTicketThread]);
    expect(groups.ticketThreadsById.get("ticket-1")).toEqual([visibleTicketThread]);
    expect(groups.ticketThreadsById.has("ticket-2")).toBe(false);
  });
});
