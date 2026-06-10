import { describe, expect, it } from "vite-plus/test";

import type { ProjectThread } from "~/t3work/t3work-types";
import { buildProjectSidebarThreadTree } from "./t3work-projectSidebarThreadTree";

function createThread(overrides: Partial<ProjectThread> = {}): ProjectThread {
  return {
    id: overrides.id ?? "thread-1",
    projectId: overrides.projectId ?? "project-1",
    title: overrides.title ?? "Thread",
    status: overrides.status ?? "idle",
    messageCount: overrides.messageCount ?? 0,
    lastMessageAt: overrides.lastMessageAt ?? "2026-05-26T12:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-05-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildProjectSidebarThreadTree", () => {
  it("nests child threads under their parent when both are present", () => {
    const parentThread = createThread({ id: "thread-parent", ticketId: "ticket-1" });
    const childThread = createThread({
      id: "thread-child",
      ticketId: "ticket-1",
      parentThreadId: "thread-parent",
    });
    const siblingThread = createThread({ id: "thread-sibling", ticketId: "ticket-1" });

    const tree = buildProjectSidebarThreadTree([parentThread, childThread, siblingThread]);

    expect(tree.rootThreads).toEqual([parentThread, siblingThread]);
    expect(tree.childThreadsByParentId.get("thread-parent")).toEqual([childThread]);
  });

  it("keeps threads at the root when their parent is missing", () => {
    const orphanThread = createThread({
      id: "thread-orphan",
      ticketId: "ticket-1",
      parentThreadId: "thread-missing",
    });

    const tree = buildProjectSidebarThreadTree([orphanThread]);

    expect(tree.rootThreads).toEqual([orphanThread]);
    expect(tree.childThreadsByParentId.size).toBe(0);
  });
});
