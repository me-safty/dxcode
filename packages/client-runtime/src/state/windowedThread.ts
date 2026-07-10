import type {
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationGetThreadHistoryPageResult,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ThreadHistoryCursor,
  WindowedOrchestrationThread,
} from "@t3tools/contracts";

export interface WindowedOrchestrationThreadState {
  readonly syncVersion: 2;
  readonly id: WindowedOrchestrationThread["head"]["id"];
  readonly projectId: WindowedOrchestrationThread["head"]["projectId"];
  readonly title: string;
  readonly modelSelection: WindowedOrchestrationThread["head"]["modelSelection"];
  readonly runtimeMode: WindowedOrchestrationThread["head"]["runtimeMode"];
  readonly interactionMode: WindowedOrchestrationThread["head"]["interactionMode"];
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly session: OrchestrationSession | null;
  readonly historyEpoch: number;
  readonly lastAppliedSequence: number;
  readonly before: ThreadHistoryCursor;
  readonly hasOlderMessages: boolean;
  readonly hasOlderActivities: boolean;
  readonly messageCount: number;
  readonly activityCount: number;
  readonly pendingRequests: ReadonlyArray<OrchestrationThreadActivity>;
}

export type ThreadDetailData = OrchestrationThread | WindowedOrchestrationThreadState;

export function isWindowedThread(
  thread: ThreadDetailData,
): thread is WindowedOrchestrationThreadState {
  return "syncVersion" in thread && thread.syncVersion === 2;
}

function mergeActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  pendingRequests: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  for (const pending of pendingRequests) byId.set(pending.id, pending);
  return [...byId.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function fromWindowSnapshot(
  window: WindowedOrchestrationThread,
): WindowedOrchestrationThreadState {
  const head = window.head;
  return {
    syncVersion: 2,
    id: head.id,
    projectId: head.projectId,
    title: head.title,
    modelSelection: head.modelSelection,
    runtimeMode: head.runtimeMode,
    interactionMode: head.interactionMode,
    branch: head.branch,
    worktreePath: head.worktreePath,
    latestTurn: head.latestTurn,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    archivedAt: head.archivedAt,
    deletedAt: head.deletedAt,
    messages: window.messages,
    activities: mergeActivities(window.activities, head.pendingRequests),
    proposedPlans: head.activeProposedPlan === null ? [] : [head.activeProposedPlan],
    checkpoints: [],
    session: head.session,
    historyEpoch: window.historyEpoch,
    lastAppliedSequence: window.lastAppliedSequence,
    before: window.before,
    hasOlderMessages: window.hasOlderMessages,
    hasOlderActivities: window.hasOlderActivities,
    messageCount: head.counts.messages,
    activityCount: head.counts.activities,
    pendingRequests: head.pendingRequests,
  };
}

export function toWindowSnapshot(
  thread: WindowedOrchestrationThreadState,
): WindowedOrchestrationThread {
  const pendingIds = new Set(thread.pendingRequests.map((activity) => activity.id));
  return {
    syncVersion: 2,
    historyEpoch: thread.historyEpoch,
    lastAppliedSequence: thread.lastAppliedSequence,
    head: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
      session: thread.session,
      activeProposedPlan: thread.proposedPlans.at(-1) ?? null,
      pendingRequests: thread.pendingRequests,
      counts: {
        messages: thread.messageCount,
        activities: thread.activityCount,
      },
    },
    messages: thread.messages,
    activities: thread.activities.filter((activity) => !pendingIds.has(activity.id)),
    before: thread.before,
    hasOlderMessages: thread.hasOlderMessages,
    hasOlderActivities: thread.hasOlderActivities,
  };
}

export function mergeWindowHistoryPage(
  thread: WindowedOrchestrationThreadState,
  page: OrchestrationGetThreadHistoryPageResult,
): WindowedOrchestrationThreadState {
  if (page.historyEpoch !== thread.historyEpoch) return thread;
  const messageById = new Map(thread.messages.map((message) => [message.id, message]));
  for (const message of page.messages) messageById.set(message.id, message);
  const activityById = new Map(thread.activities.map((activity) => [activity.id, activity]));
  for (const activity of page.activities) activityById.set(activity.id, activity);
  return {
    ...thread,
    messages: [...messageById.values()].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    ),
    activities: [...activityById.values()].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    ),
    before: page.before,
    hasOlderMessages: page.hasOlderMessages,
    hasOlderActivities: page.hasOlderActivities,
  };
}

export type WindowedThreadReducerResult =
  | {
      readonly kind: "updated";
      readonly thread: WindowedOrchestrationThreadState;
    }
  | { readonly kind: "deleted" }
  | { readonly kind: "resync" }
  | { readonly kind: "unchanged" };

function upsertMessage(
  messages: ReadonlyArray<OrchestrationMessage>,
  message: OrchestrationMessage,
): {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly inserted: boolean;
} {
  const existing = messages.find((entry) => entry.id === message.id);
  if (existing === undefined) return { messages: [...messages, message], inserted: true };
  return {
    inserted: false,
    messages: messages.map((entry) =>
      entry.id !== message.id
        ? entry
        : {
            ...entry,
            text: message.streaming
              ? `${entry.text}${message.text}`
              : message.text.length > 0
                ? message.text
                : entry.text,
            streaming: message.streaming,
            updatedAt: message.streaming ? entry.updatedAt : message.updatedAt,
            ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
          },
    ),
  };
}

export function applyWindowedThreadEvent(
  thread: WindowedOrchestrationThreadState,
  event: OrchestrationEvent,
): WindowedThreadReducerResult {
  switch (event.type) {
    case "thread.deleted":
      return { kind: "deleted" };
    case "thread.reverted":
      return { kind: "resync" };
    case "thread.archived":
      return {
        kind: "updated",
        thread: {
          ...thread,
          archivedAt: event.payload.archivedAt,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.unarchived":
      return {
        kind: "updated",
        thread: {
          ...thread,
          archivedAt: null,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.meta-updated":
      return {
        kind: "updated",
        thread: {
          ...thread,
          ...(event.payload.title === undefined ? {} : { title: event.payload.title }),
          ...(event.payload.modelSelection === undefined
            ? {}
            : { modelSelection: event.payload.modelSelection }),
          ...(event.payload.branch === undefined ? {} : { branch: event.payload.branch }),
          ...(event.payload.worktreePath === undefined
            ? {}
            : { worktreePath: event.payload.worktreePath }),
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.runtime-mode-set":
      return {
        kind: "updated",
        thread: {
          ...thread,
          runtimeMode: event.payload.runtimeMode,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.interaction-mode-set":
      return {
        kind: "updated",
        thread: {
          ...thread,
          interactionMode: event.payload.interactionMode,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.turn-start-requested":
      return {
        kind: "updated",
        thread: {
          ...thread,
          ...(event.payload.modelSelection === undefined
            ? {}
            : { modelSelection: event.payload.modelSelection }),
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          updatedAt: event.occurredAt,
        },
      };
    case "thread.turn-interrupt-requested":
      return event.payload.turnId === undefined ||
        thread.latestTurn?.turnId !== event.payload.turnId
        ? { kind: "unchanged" }
        : {
            kind: "updated",
            thread: {
              ...thread,
              latestTurn: {
                ...thread.latestTurn,
                state: "interrupted",
                startedAt: thread.latestTurn.startedAt ?? event.payload.createdAt,
                completedAt: thread.latestTurn.completedAt ?? event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
          };
    case "thread.message-sent": {
      const next = upsertMessage(thread.messages, {
        id: event.payload.messageId,
        role: event.payload.role,
        text: event.payload.text,
        ...(event.payload.attachments === undefined
          ? {}
          : { attachments: event.payload.attachments }),
        turnId: event.payload.turnId,
        streaming: event.payload.streaming,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      });
      const turnStillRunning =
        event.payload.turnId !== null &&
        thread.session?.status === "running" &&
        thread.session.activeTurnId === event.payload.turnId;
      const settlesTurn = !event.payload.streaming && !turnStillRunning;
      const latestTurn =
        event.payload.role === "assistant" &&
        event.payload.turnId !== null &&
        (thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId)
          ? {
              turnId: event.payload.turnId,
              state: settlesTurn
                ? thread.latestTurn?.state === "interrupted"
                  ? ("interrupted" as const)
                  : thread.latestTurn?.state === "error"
                    ? ("error" as const)
                    : ("completed" as const)
                : ("running" as const),
              requestedAt:
                thread.latestTurn?.turnId === event.payload.turnId
                  ? thread.latestTurn.requestedAt
                  : event.payload.createdAt,
              startedAt:
                thread.latestTurn?.turnId === event.payload.turnId
                  ? (thread.latestTurn.startedAt ?? event.payload.createdAt)
                  : event.payload.createdAt,
              completedAt: settlesTurn ? event.payload.updatedAt : null,
              assistantMessageId: event.payload.messageId,
            }
          : thread.latestTurn;
      return {
        kind: "updated",
        thread: {
          ...thread,
          messages: next.messages,
          messageCount: thread.messageCount + (next.inserted ? 1 : 0),
          latestTurn,
          updatedAt: event.occurredAt,
        },
      };
    }
    case "thread.activity-appended": {
      const inserted = !thread.activities.some(
        (activity) => activity.id === event.payload.activity.id,
      );
      const activities = mergeActivities(
        thread.activities.filter((activity) => activity.id !== event.payload.activity.id),
        [event.payload.activity],
      );
      return {
        kind: "updated",
        thread: {
          ...thread,
          activities,
          activityCount: thread.activityCount + (inserted ? 1 : 0),
          updatedAt: event.occurredAt,
        },
      };
    }
    case "thread.session-set": {
      const session = event.payload.session;
      const latestTurn =
        session.status === "running" && session.activeTurnId !== null
          ? {
              turnId: session.activeTurnId,
              state: "running" as const,
              requestedAt:
                thread.latestTurn?.turnId === session.activeTurnId
                  ? thread.latestTurn.requestedAt
                  : session.updatedAt,
              startedAt:
                thread.latestTurn?.turnId === session.activeTurnId
                  ? (thread.latestTurn.startedAt ?? session.updatedAt)
                  : session.updatedAt,
              completedAt: null,
              assistantMessageId:
                thread.latestTurn?.turnId === session.activeTurnId
                  ? thread.latestTurn.assistantMessageId
                  : null,
            }
          : thread.latestTurn?.state === "running"
            ? {
                ...thread.latestTurn,
                state: session.status === "error" ? ("error" as const) : ("completed" as const),
                completedAt: session.updatedAt,
              }
            : thread.latestTurn;
      return {
        kind: "updated",
        thread: { ...thread, session, latestTurn, updatedAt: event.occurredAt },
      };
    }
    case "thread.session-stop-requested":
      return thread.session === null
        ? { kind: "unchanged" }
        : {
            kind: "updated",
            thread: {
              ...thread,
              session: {
                ...thread.session,
                status: "stopped",
                activeTurnId: null,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
          };
    case "thread.proposed-plan-upserted":
      return {
        kind: "updated",
        thread: {
          ...thread,
          proposedPlans: [event.payload.proposedPlan],
          updatedAt: event.occurredAt,
        },
      };
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
    case "thread.created":
    case "thread.turn-diff-completed":
    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
    case "thread.checkpoint-revert-requested":
      return { kind: "unchanged" };
  }
  return { kind: "unchanged" };
}
