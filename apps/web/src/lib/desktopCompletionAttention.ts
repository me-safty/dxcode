import type { OrchestrationLatestTurnState, OrchestrationSessionStatus } from "@t3tools/contracts";
import type { Thread } from "../types";

export interface CompletionAttentionState {
  activeTurnId: string | null;
  completedAt: string | null;
  isWorking: boolean;
  lastError: string | null;
  latestTurnId: string | null;
  latestTurnState: OrchestrationLatestTurnState | null;
  sessionStatus: OrchestrationSessionStatus | null;
}

export function getCompletionAttentionState(
  thread: Pick<Thread, "latestTurn" | "session"> | undefined,
): CompletionAttentionState {
  return {
    activeTurnId: thread?.session?.activeTurnId ?? null,
    completedAt: thread?.latestTurn?.completedAt ?? null,
    isWorking:
      thread?.session?.orchestrationStatus === "starting" ||
      thread?.session?.orchestrationStatus === "running" ||
      thread?.latestTurn?.state === "running",
    lastError: thread?.session?.lastError ?? null,
    latestTurnId: thread?.latestTurn?.turnId ?? null,
    latestTurnState: thread?.latestTurn?.state ?? null,
    sessionStatus: thread?.session?.orchestrationStatus ?? null,
  };
}

export function getCompletionAttentionTurnId(
  previous: CompletionAttentionState | undefined,
  next: CompletionAttentionState,
): string | null {
  const completedTurnTransition =
    next.latestTurnId !== null &&
    next.latestTurnState === "completed" &&
    next.completedAt !== null &&
    previous?.completedAt !== next.completedAt &&
    previous?.isWorking === true &&
    !next.isWorking;

  const sessionReadyTransition =
    previous?.isWorking === true &&
    previous.activeTurnId !== null &&
    next.sessionStatus === "ready" &&
    next.activeTurnId === null &&
    next.lastError === null;

  if (completedTurnTransition) {
    return next.latestTurnId;
  }
  if (sessionReadyTransition) {
    return previous.activeTurnId;
  }
  return null;
}

export function updateCompletionAttentionNotification(
  notifications: Map<string, string>,
  threadId: string,
  lastNotifiedTurnId: string | undefined,
  attentionTurnId: string | null,
): boolean {
  if (attentionTurnId === null) {
    if (lastNotifiedTurnId) {
      notifications.set(threadId, lastNotifiedTurnId);
    }
    return false;
  }

  notifications.set(threadId, attentionTurnId);
  return attentionTurnId !== lastNotifiedTurnId;
}

export function shouldRequestCompletionAttention(
  previous: CompletionAttentionState | undefined,
  next: CompletionAttentionState,
): boolean {
  return getCompletionAttentionTurnId(previous, next) !== null;
}
