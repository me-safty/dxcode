import type {
  DesktopNotificationEvent,
  EnvironmentId,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";

export type DesktopNotificationThread = Pick<
  OrchestrationThreadShell,
  | "id"
  | "updatedAt"
  | "archivedAt"
  | "latestTurn"
  | "session"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
>;

interface ThreadAttentionState {
  readonly threadId: ThreadId;
  readonly updatedAt: string;
  readonly turnId: string | null;
  readonly turnState: "running" | "interrupted" | "completed" | "error" | null;
  readonly runningTurnId: string | null;
  readonly isTurnActive: boolean;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}

export interface DesktopNotificationTrackerState {
  readonly syncKey: string | null;
  readonly threads: ReadonlyMap<string, ThreadAttentionState>;
}

export interface DesktopNotificationObservation {
  readonly active: boolean;
  readonly syncKey: string;
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<DesktopNotificationThread>;
}

export interface DesktopNotificationReduction {
  readonly state: DesktopNotificationTrackerState;
  readonly events: ReadonlyArray<DesktopNotificationEvent>;
}

export const EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE: DesktopNotificationTrackerState = {
  syncKey: null,
  threads: new Map(),
};

function toAttentionState(thread: DesktopNotificationThread): ThreadAttentionState | null {
  if (thread.archivedAt !== null) return null;
  return {
    threadId: thread.id,
    updatedAt: thread.updatedAt,
    turnId: thread.latestTurn?.turnId ?? null,
    turnState: thread.latestTurn?.state ?? null,
    runningTurnId:
      thread.session?.activeTurnId ??
      (thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null),
    isTurnActive: thread.session?.status === "starting" || thread.session?.status === "running",
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
  };
}

function collectAttentionStates(threads: ReadonlyArray<DesktopNotificationThread>) {
  const states = new Map<string, ThreadAttentionState>();
  for (const thread of threads) {
    const state = toAttentionState(thread);
    if (state !== null) states.set(thread.id, state);
  }
  return states;
}

function preserveSettlingTurn(
  previous: ThreadAttentionState,
  next: ThreadAttentionState,
): ThreadAttentionState {
  if (next.runningTurnId !== null || previous.runningTurnId === null) return next;
  const isSettled = next.turnId === previous.runningTurnId && next.turnState !== "running";
  return isSettled ? next : { ...next, runningTurnId: previous.runningTurnId };
}

function reconcileAttentionStates(
  previous: ReadonlyMap<string, ThreadAttentionState>,
  next: ReadonlyMap<string, ThreadAttentionState>,
) {
  return new Map(
    [...next].map(([threadId, state]) => {
      const prior = previous.get(threadId);
      return [threadId, prior === undefined ? state : preserveSettlingTurn(prior, state)] as const;
    }),
  );
}

function makeEvent(
  environmentId: EnvironmentId,
  state: ThreadAttentionState,
  kind: DesktopNotificationEvent["kind"],
  identity: string,
): DesktopNotificationEvent {
  return {
    eventId: `${environmentId}:${state.threadId}:${kind}:${identity}`,
    kind,
    environmentId,
    threadId: state.threadId,
  };
}

function deriveTurnEvent(
  environmentId: EnvironmentId,
  previous: ThreadAttentionState,
  next: ThreadAttentionState,
): DesktopNotificationEvent | null {
  const sameRunningTurn = previous.runningTurnId !== null && previous.runningTurnId === next.turnId;
  if (!sameRunningTurn || next.isTurnActive) return null;
  if (next.turnState === "completed") {
    return makeEvent(environmentId, next, "turn-completed", next.turnId);
  }
  if (next.turnState === "error") {
    return makeEvent(environmentId, next, "turn-failed", next.turnId);
  }
  return null;
}

function derivePendingEvents(
  environmentId: EnvironmentId,
  previous: ThreadAttentionState,
  next: ThreadAttentionState,
): DesktopNotificationEvent[] {
  const events: DesktopNotificationEvent[] = [];
  if (!previous.hasPendingApprovals && next.hasPendingApprovals) {
    events.push(makeEvent(environmentId, next, "approval-required", next.updatedAt));
  }
  if (!previous.hasPendingUserInput && next.hasPendingUserInput) {
    events.push(makeEvent(environmentId, next, "user-input-required", next.updatedAt));
  }
  return events;
}

function deriveThreadEvents(
  environmentId: EnvironmentId,
  previous: ThreadAttentionState,
  next: ThreadAttentionState,
): DesktopNotificationEvent[] {
  const turnEvent = deriveTurnEvent(environmentId, previous, next);
  return [
    ...(turnEvent === null ? [] : [turnEvent]),
    ...derivePendingEvents(environmentId, previous, next),
  ];
}

export function reduceDesktopNotificationObservation(
  state: DesktopNotificationTrackerState,
  observation: DesktopNotificationObservation,
): DesktopNotificationReduction {
  if (!observation.active) {
    return { state: EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE, events: [] };
  }
  const observedThreads = collectAttentionStates(observation.threads);
  if (state.syncKey !== observation.syncKey) {
    return { state: { syncKey: observation.syncKey, threads: observedThreads }, events: [] };
  }
  const threads = reconcileAttentionStates(state.threads, observedThreads);
  const events = [...threads].flatMap(([threadId, next]) => {
    const previous = state.threads.get(threadId);
    return previous === undefined
      ? []
      : deriveThreadEvents(observation.environmentId, previous, next);
  });
  return { state: { syncKey: observation.syncKey, threads }, events };
}
