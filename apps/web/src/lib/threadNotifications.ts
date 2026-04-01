import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import type { Project, Thread } from "../types";

// ── Types ─────────────────────────────────────────────────────────────

export type ThreadNotificationStatus =
  | "completed"
  | "pending-approval"
  | "pending-input"
  | "working"
  | null;

export interface ThreadNotificationSnapshot {
  threadId: ThreadId;
  projectName: string;
  threadTitle: string;
  status: ThreadNotificationStatus;
  pendingApprovalCount: number;
  pendingInputCount: number;
  lastCompletedTurnId: string | null;
}

export type ThreadNotificationKind = "completed" | "pending-approval" | "pending-input";

export interface ThreadNotification {
  threadId: ThreadId;
  projectName: string;
  threadTitle: string;
  kind: ThreadNotificationKind;
}

// ── Snapshot collection ───────────────────────────────────────────────

const PENDING_STATUS_DEFS = [
  {
    status: "pending-approval" as const,
    kind: "pending-approval" as const,
    countKey: "pendingApprovalCount" as const,
  },
  {
    status: "pending-input" as const,
    kind: "pending-input" as const,
    countKey: "pendingInputCount" as const,
  },
] as const;

export function collectThreadNotificationSnapshots(
  threads: ReadonlyArray<Thread>,
  projects: ReadonlyArray<Project>,
): Map<ThreadId, ThreadNotificationSnapshot> {
  const projectNameById = new Map<ProjectId, string>();
  for (const project of projects) {
    projectNameById.set(project.id, project.name);
  }

  const snapshots = new Map<ThreadId, ThreadNotificationSnapshot>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;

    const pendingApprovals = derivePendingApprovals(thread.activities);
    const pendingInputs = derivePendingUserInputs(thread.activities);

    let status: ThreadNotificationStatus = null;
    if (pendingApprovals.length > 0) {
      status = "pending-approval";
    } else if (pendingInputs.length > 0) {
      status = "pending-input";
    } else if (
      thread.session?.status === "running" ||
      thread.session?.orchestrationStatus === "running"
    ) {
      status = "working";
    } else if (thread.latestTurn?.state === "completed" && thread.latestTurn.completedAt) {
      // Interrupted and errored turns also set completedAt but should not
      // fire a success notification.
      status = "completed";
    }

    snapshots.set(thread.id, {
      threadId: thread.id,
      projectName: projectNameById.get(thread.projectId) ?? "Unknown project",
      threadTitle: thread.title || "Untitled thread",
      status,
      pendingApprovalCount: pendingApprovals.length,
      pendingInputCount: pendingInputs.length,
      lastCompletedTurnId:
        thread.latestTurn?.state === "completed" ? thread.latestTurn.turnId : null,
    });
  }
  return snapshots;
}

// ── Diff logic ────────────────────────────────────────────────────────

export function diffThreadNotifications(
  previous: ReadonlyMap<ThreadId, ThreadNotificationSnapshot>,
  current: ReadonlyMap<ThreadId, ThreadNotificationSnapshot>,
): ThreadNotification[] {
  const notifications: ThreadNotification[] = [];

  for (const [threadId, currentSnap] of current) {
    const previousSnap = previous.get(threadId);
    const previousStatus = previousSnap?.status ?? null;
    const currentStatus = currentSnap.status;
    const base = {
      threadId,
      projectName: currentSnap.projectName,
      threadTitle: currentSnap.threadTitle,
    };

    let handledAsPending = false;
    for (const def of PENDING_STATUS_DEFS) {
      if (currentStatus !== def.status) continue;
      handledAsPending = true;
      const countChanged =
        previousSnap !== undefined && currentSnap[def.countKey] > previousSnap[def.countKey];
      if (previousStatus !== currentStatus || countChanged) {
        notifications.push({ ...base, kind: def.kind });
      }
      break;
    }
    if (handledAsPending) continue;

    if (currentStatus === "completed") {
      const turnChanged =
        previousSnap !== undefined &&
        currentSnap.lastCompletedTurnId !== null &&
        currentSnap.lastCompletedTurnId !== previousSnap.lastCompletedTurnId;
      if (previousStatus === "working" || turnChanged) {
        notifications.push({ ...base, kind: "completed" });
      }
    }
  }

  return notifications;
}

// ── Notification text ─────────────────────────────────────────────────

const NOTIFICATION_TITLE_BY_KIND: Record<ThreadNotificationKind, string> = {
  completed: "Task completed",
  "pending-approval": "Approval required",
  "pending-input": "Input required",
};

const NOTIFICATION_BODY_SUFFIX_BY_KIND: Record<ThreadNotificationKind, string> = {
  completed: "has finished working.",
  "pending-approval": "needs your approval to continue.",
  "pending-input": "is waiting for your input.",
};

export function getNotificationTitle(kind: ThreadNotificationKind): string {
  return NOTIFICATION_TITLE_BY_KIND[kind];
}

export function getNotificationBody(
  kind: ThreadNotificationKind,
  projectName: string,
  threadTitle: string,
): string {
  return `${projectName} / ${threadTitle} ${NOTIFICATION_BODY_SUFFIX_BY_KIND[kind]}`;
}

// ── Consolidation ─────────────────────────────────────────────────────

const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

export interface ConsolidatedNotification {
  title: string;
  body: string;
  threadId: ThreadId | null;
}

export function consolidateNotifications(
  notifications: ReadonlyArray<ThreadNotification>,
): ConsolidatedNotification[] {
  if (notifications.length === 0) return [];

  if (notifications.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
    return notifications.map((notification) => ({
      title: getNotificationTitle(notification.kind),
      body: getNotificationBody(
        notification.kind,
        notification.projectName,
        notification.threadTitle,
      ),
      threadId: notification.threadId,
    }));
  }

  const counts: Record<ThreadNotificationKind, number> = {
    "pending-approval": 0,
    "pending-input": 0,
    completed: 0,
  };
  for (const n of notifications) counts[n.kind]++;

  const parts: string[] = [];
  if (counts["pending-approval"] > 0)
    parts.push(
      `${counts["pending-approval"]} need${counts["pending-approval"] === 1 ? "s" : ""} approval`,
    );
  if (counts["pending-input"] > 0)
    parts.push(`${counts["pending-input"]} need${counts["pending-input"] === 1 ? "s" : ""} input`);
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);

  return [
    {
      title: `${notifications.length} threads need attention`,
      body: parts.join(", "),
      threadId: null,
    },
  ];
}
