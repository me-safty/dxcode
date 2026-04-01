import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  type ThreadNotificationSnapshot,
  type ThreadNotification,
  collectThreadNotificationSnapshots,
  consolidateNotifications,
  diffThreadNotifications,
  getNotificationBody,
  getNotificationTitle,
} from "./threadNotifications";
import type { Project, Thread } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────

function makeThreadId(id: string): ThreadId {
  return ThreadId.makeUnsafe(id);
}

const TEST_PROJECT: Project = {
  id: ProjectId.makeUnsafe("project-1"),
  name: "My Project",
  cwd: "/tmp/test",
  defaultModelSelection: null,
  scripts: [],
};

function snap(
  threadId: string,
  status: ThreadNotificationSnapshot["status"],
  overrides?: Partial<
    Pick<
      ThreadNotificationSnapshot,
      | "threadTitle"
      | "projectName"
      | "pendingApprovalCount"
      | "pendingInputCount"
      | "lastCompletedTurnId"
    >
  >,
): [ThreadId, ThreadNotificationSnapshot] {
  const id = makeThreadId(threadId);
  return [
    id,
    {
      threadId: id,
      projectName: overrides?.projectName ?? "My Project",
      threadTitle: overrides?.threadTitle ?? "Test thread",
      status,
      pendingApprovalCount: overrides?.pendingApprovalCount ?? 0,
      pendingInputCount: overrides?.pendingInputCount ?? 0,
      lastCompletedTurnId: overrides?.lastCompletedTurnId ?? null,
    },
  ];
}

function makeMinimalThread(
  overrides: Omit<Partial<Thread>, "id"> & { id: string; title?: string },
): Thread {
  return {
    id: ThreadId.makeUnsafe(overrides.id),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: overrides.title ?? "Test thread",
    modelSelection: { provider: "codex", model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: overrides.session ?? null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: overrides.archivedAt ?? null,
    latestTurn: overrides.latestTurn ?? null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: overrides.activities ?? [],
  } as Thread;
}

// ── diffThreadNotifications ───────────────────────────────────────────

describe("diffThreadNotifications", () => {
  it("notifies on working -> completed", () => {
    const prev = new Map([snap("t1", "working")]);
    const curr = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-1" })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "completed", threadId: makeThreadId("t1") });
  });

  it("notifies on working -> pending-approval", () => {
    const prev = new Map([snap("t1", "working")]);
    const curr = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 1 })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "pending-approval" });
  });

  it("notifies on working -> pending-input", () => {
    const prev = new Map([snap("t1", "working")]);
    const curr = new Map([snap("t1", "pending-input", { pendingInputCount: 1 })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "pending-input" });
  });

  it("notifies on null -> pending-approval for new thread", () => {
    const prev = new Map<ThreadId, ThreadNotificationSnapshot>();
    const curr = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 1 })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "pending-approval" });
  });

  it("does not notify when status and counts stay the same", () => {
    const prev = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 1 })]);
    const curr = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 1 })]);
    expect(diffThreadNotifications(prev, curr)).toEqual([]);
  });

  it("does not notify on null -> completed (no prior working state)", () => {
    const prev = new Map<ThreadId, ThreadNotificationSnapshot>();
    const curr = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-1" })]);
    expect(diffThreadNotifications(prev, curr)).toEqual([]);
  });

  it("does not notify on completed -> completed with same turn", () => {
    const prev = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-1" })]);
    const curr = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-1" })]);
    expect(diffThreadNotifications(prev, curr)).toEqual([]);
  });

  it("includes project name in notification", () => {
    const prev = new Map([
      snap("t1", "working", { threadTitle: "Fix bug", projectName: "my-app" }),
    ]);
    const curr = new Map([
      snap("t1", "completed", {
        threadTitle: "Fix bug",
        projectName: "my-app",
        lastCompletedTurnId: "turn-1",
      }),
    ]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ projectName: "my-app", threadTitle: "Fix bug" });
  });

  it("handles multiple threads with mixed transitions", () => {
    const prev = new Map([snap("t1", "working"), snap("t2", "working"), snap("t3", null)]);
    const curr = new Map([
      snap("t1", "completed", { lastCompletedTurnId: "turn-1" }),
      snap("t2", "pending-approval", { pendingApprovalCount: 1 }),
      snap("t3", null),
    ]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.kind).toSorted()).toEqual(["completed", "pending-approval"]);
  });

  // ── Edge cases from audit ─────────────────────────────────────────

  it("notifies when a new approval arrives on an already pending-approval thread", () => {
    const prev = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 1 })]);
    const curr = new Map([snap("t1", "pending-approval", { pendingApprovalCount: 2 })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "pending-approval" });
  });

  it("notifies when a new input request arrives on an already pending-input thread", () => {
    const prev = new Map([snap("t1", "pending-input", { pendingInputCount: 1 })]);
    const curr = new Map([snap("t1", "pending-input", { pendingInputCount: 2 })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "pending-input" });
  });

  it("notifies when a different turn completes on an already completed thread", () => {
    const prev = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-1" })]);
    const curr = new Map([snap("t1", "completed", { lastCompletedTurnId: "turn-2" })]);
    const result = diffThreadNotifications(prev, curr);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "completed" });
  });
});

// ── collectThreadNotificationSnapshots ────────────────────────────────

describe("collectThreadNotificationSnapshots", () => {
  it("skips archived threads", () => {
    const threads = [
      makeMinimalThread({ id: "t1", archivedAt: "2026-01-01T00:00:00Z" }),
      makeMinimalThread({ id: "t2" }),
    ];
    const snapshots = collectThreadNotificationSnapshots(threads, [TEST_PROJECT]);
    expect(snapshots.size).toBe(1);
    expect(snapshots.has(makeThreadId("t2"))).toBe(true);
  });

  it("derives working status from session", () => {
    const thread = makeMinimalThread({
      id: "t1",
      session: {
        provider: "codex",
        status: "running",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        orchestrationStatus: "running",
      },
    });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.status).toBe("working");
  });

  it("derives completed status from latestTurn with state=completed", () => {
    const thread = makeMinimalThread({
      id: "t1",
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "completed",
        requestedAt: "2026-01-01T00:00:00Z",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        assistantMessageId: null,
      },
    });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.status).toBe("completed");
  });

  it("does NOT derive completed status from interrupted turns", () => {
    const thread = makeMinimalThread({
      id: "t1",
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "interrupted",
        requestedAt: "2026-01-01T00:00:00Z",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        assistantMessageId: null,
      },
    });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.status).toBeNull();
  });

  it("does NOT derive completed status from errored turns", () => {
    const thread = makeMinimalThread({
      id: "t1",
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "error",
        requestedAt: "2026-01-01T00:00:00Z",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        assistantMessageId: null,
      },
    });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.status).toBeNull();
  });

  it("resolves project name from projects list", () => {
    const thread = makeMinimalThread({ id: "t1" });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.projectName).toBe("My Project");
  });

  it("falls back to 'Unknown project' when project is missing", () => {
    const thread = makeMinimalThread({ id: "t1" });
    const snapshots = collectThreadNotificationSnapshots([thread], []);
    expect(snapshots.get(makeThreadId("t1"))?.projectName).toBe("Unknown project");
  });

  it("uses thread title or fallback", () => {
    const thread = makeMinimalThread({ id: "t1", title: "" });
    const snapshots = collectThreadNotificationSnapshots([thread], [TEST_PROJECT]);
    expect(snapshots.get(makeThreadId("t1"))?.threadTitle).toBe("Untitled thread");
  });
});

// ── consolidateNotifications ──────────────────────────────────────────

describe("consolidateNotifications", () => {
  it("returns empty for no notifications", () => {
    expect(consolidateNotifications([])).toEqual([]);
  });

  it("returns individual notifications for small batches", () => {
    const notifications: ThreadNotification[] = [
      {
        threadId: makeThreadId("t1"),
        projectName: "Proj",
        threadTitle: "Thread 1",
        kind: "completed",
      },
      {
        threadId: makeThreadId("t2"),
        projectName: "Proj",
        threadTitle: "Thread 2",
        kind: "pending-approval",
      },
    ];
    const result = consolidateNotifications(notifications);
    expect(result).toHaveLength(2);
    expect(result[0]?.threadId).toEqual(makeThreadId("t1"));
    expect(result[1]?.threadId).toEqual(makeThreadId("t2"));
  });

  it("consolidates when exceeding threshold", () => {
    const notifications: ThreadNotification[] = [
      { threadId: makeThreadId("t1"), projectName: "P", threadTitle: "T1", kind: "completed" },
      { threadId: makeThreadId("t2"), projectName: "P", threadTitle: "T2", kind: "completed" },
      {
        threadId: makeThreadId("t3"),
        projectName: "P",
        threadTitle: "T3",
        kind: "pending-approval",
      },
      { threadId: makeThreadId("t4"), projectName: "P", threadTitle: "T4", kind: "pending-input" },
    ];
    const result = consolidateNotifications(notifications);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("4 threads need attention");
    expect(result[0]?.threadId).toBeNull();
  });
});

// ── Notification text helpers ─────────────────────────────────────────

describe("getNotificationTitle", () => {
  it("returns correct title for each kind", () => {
    expect(getNotificationTitle("completed")).toBe("Task completed");
    expect(getNotificationTitle("pending-approval")).toBe("Approval required");
    expect(getNotificationTitle("pending-input")).toBe("Input required");
  });
});

describe("getNotificationBody", () => {
  it("formats as ProjectName / ThreadTitle + suffix", () => {
    expect(getNotificationBody("completed", "my-app", "Fix login bug")).toBe(
      "my-app / Fix login bug has finished working.",
    );
    expect(getNotificationBody("pending-approval", "my-app", "Add auth")).toBe(
      "my-app / Add auth needs your approval to continue.",
    );
    expect(getNotificationBody("pending-input", "my-app", "Setup CI")).toBe(
      "my-app / Setup CI is waiting for your input.",
    );
  });
});
