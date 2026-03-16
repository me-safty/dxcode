import type { OrchestrationReadModel, ThreadId } from "@t3tools/contracts";
import type { AppSettings } from "./appSettings";
import { resolveCustomNotificationSoundSrc } from "./notificationSoundStorage";

export type NotificationPermissionState = "unavailable" | "default" | "granted" | "denied";
export type TurnCompletionOutcome = "success" | "error" | "interrupted";

export interface SettledTurnNotificationCandidate {
  threadId: ThreadId;
  threadTitle: string;
  projectTitle: string | null;
  outcome: TurnCompletionOutcome;
  turnId: string;
  completedAt: string;
}

export interface NotificationDedupeState {
  initialized: boolean;
  settlementKeyByThreadId: Map<string, string | null>;
}

interface DispatchTurnCompletionEffectsInput {
  settledTurn: SettledTurnNotificationCandidate;
  settings: Pick<
    AppSettings,
    | "enableSystemNotifications"
    | "enableCompletionSound"
    | "notificationSoundSelection"
    | "notificationCustomSoundId"
  >;
  backgrounded: boolean;
  onOpenThread: (threadId: ThreadId) => void;
}

interface PlayCompletionSoundOptions {
  src?: string | null;
  swallowErrors?: boolean;
}

interface ShowTurnCompletionNotificationInput {
  settledTurn: SettledTurnNotificationCandidate;
  onOpenThread: (threadId: ThreadId) => void;
}

let completionSound: HTMLAudioElement | null = null;
let completionSoundSrc: string | null = null;

function getSettledTurnOutcome(
  thread: OrchestrationReadModel["threads"][number],
): TurnCompletionOutcome | null {
  if (!thread.latestTurn?.completedAt) {
    return null;
  }

  switch (thread.latestTurn.state) {
    case "completed":
      return "success";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    case "running":
      return null;
  }
}

function getSettledTurnKey(thread: OrchestrationReadModel["threads"][number]): string | null {
  const outcome = getSettledTurnOutcome(thread);
  const completedAt = thread.latestTurn?.completedAt;
  if (!outcome || !completedAt) {
    return null;
  }

  return `${thread.latestTurn.turnId}:${completedAt}:${thread.latestTurn.state}`;
}

function getNotificationCopy(settledTurn: SettledTurnNotificationCandidate): {
  title: string;
  body: string;
} {
  const body = settledTurn.projectTitle
    ? `${settledTurn.projectTitle} - ${settledTurn.threadTitle}`
    : settledTurn.threadTitle;

  switch (settledTurn.outcome) {
    case "success":
      return { title: "Agent finished", body };
    case "error":
      return { title: "Agent finished with an error", body };
    case "interrupted":
      return { title: "Agent was interrupted", body };
  }
}

function buildSettledTurnCandidate(
  thread: OrchestrationReadModel["threads"][number],
  projectTitle: string | null,
): SettledTurnNotificationCandidate | null {
  const outcome = getSettledTurnOutcome(thread);
  const completedAt = thread.latestTurn?.completedAt;
  if (!outcome || !completedAt) {
    return null;
  }

  return {
    threadId: thread.id,
    threadTitle: thread.title,
    projectTitle,
    outcome,
    turnId: thread.latestTurn.turnId,
    completedAt,
  };
}

function replaceSettlementKeys(
  dedupeState: NotificationDedupeState,
  nextSettlementKeyByThreadId: Map<string, string | null>,
): void {
  dedupeState.settlementKeyByThreadId.clear();
  for (const [threadId, key] of nextSettlementKeyByThreadId) {
    dedupeState.settlementKeyByThreadId.set(threadId, key);
  }
}

function createCompletionSound(src: string): HTMLAudioElement {
  if (typeof Audio === "undefined") {
    throw new Error("Audio playback is unavailable in this environment.");
  }

  const audio = new Audio(src);
  audio.preload = "auto";
  return audio;
}

export async function resolveCompletionSoundSrc(
  settings: Pick<
    AppSettings,
    "enableCompletionSound" | "notificationSoundSelection" | "notificationCustomSoundId"
  >,
): Promise<string | null> {
  if (!settings.enableCompletionSound) {
    return null;
  }

  if (
    settings.notificationSoundSelection === "custom" &&
    settings.notificationCustomSoundId.length > 0
  ) {
    const customSrc = await resolveCustomNotificationSoundSrc(settings.notificationCustomSoundId);
    return customSrc ?? "/sounds/agent-finished.mp3";
  }

  return "/sounds/agent-finished.mp3";
}

export function createNotificationDedupeState(): NotificationDedupeState {
  return {
    initialized: false,
    settlementKeyByThreadId: new Map(),
  };
}

export function seedNotificationDedupeStateFromSnapshot(
  snapshot: OrchestrationReadModel,
  dedupeState: NotificationDedupeState,
): void {
  const nextSettlementKeyByThreadId = new Map<string, string | null>();
  for (const thread of snapshot.threads) {
    nextSettlementKeyByThreadId.set(thread.id, getSettledTurnKey(thread));
  }

  dedupeState.initialized = true;
  replaceSettlementKeys(dedupeState, nextSettlementKeyByThreadId);
}

export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof Notification === "undefined") {
    return "unavailable";
  }

  switch (Notification.permission) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "default":
      return "default";
    default:
      return "unavailable";
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") {
    return "unavailable";
  }

  try {
    const permission = await Notification.requestPermission();
    switch (permission) {
      case "granted":
        return "granted";
      case "denied":
        return "denied";
      case "default":
      default:
        return "default";
    }
  } catch {
    return getNotificationPermissionState();
  }
}

export function isAppBackgrounded(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.visibilityState !== "visible" || !document.hasFocus();
}

export function collectNewlySettledTurns(
  previousSnapshot: OrchestrationReadModel | null,
  nextSnapshot: OrchestrationReadModel,
  dedupeState: NotificationDedupeState,
): SettledTurnNotificationCandidate[] {
  const previousSettlementKeyByThreadId = new Map<string, string | null>();
  if (previousSnapshot) {
    for (const thread of previousSnapshot.threads) {
      previousSettlementKeyByThreadId.set(thread.id, getSettledTurnKey(thread));
    }
  }

  const projectTitleById = new Map(
    nextSnapshot.projects.map((project) => [project.id, project.title]),
  );
  const nextSettlementKeyByThreadId = new Map<string, string | null>();
  const candidates: SettledTurnNotificationCandidate[] = [];

  for (const thread of nextSnapshot.threads) {
    const nextKey = getSettledTurnKey(thread);
    nextSettlementKeyByThreadId.set(thread.id, nextKey);

    if (!dedupeState.initialized || !nextKey) {
      continue;
    }

    const previousKey =
      dedupeState.settlementKeyByThreadId.get(thread.id) ??
      previousSettlementKeyByThreadId.get(thread.id) ??
      null;
    if (previousKey === nextKey) {
      continue;
    }

    const candidate = buildSettledTurnCandidate(
      thread,
      projectTitleById.get(thread.projectId) ?? null,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  dedupeState.initialized = true;
  replaceSettlementKeys(dedupeState, nextSettlementKeyByThreadId);

  return candidates;
}

export async function playCompletionSound(options: PlayCompletionSoundOptions = {}): Promise<void> {
  try {
    if (options.src === null) {
      return;
    }
    const src = options.src ?? "/sounds/agent-finished.mp3";
    if (!completionSound || completionSoundSrc !== src) {
      completionSound = createCompletionSound(src);
      completionSoundSrc = src;
    }
    const audio = completionSound;
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    if (options.swallowErrors) {
      return;
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function playConfiguredCompletionSound(
  settings: Pick<
    AppSettings,
    "enableCompletionSound" | "notificationSoundSelection" | "notificationCustomSoundId"
  >,
  options: Omit<PlayCompletionSoundOptions, "src"> = {},
): Promise<void> {
  const src = await resolveCompletionSoundSrc(settings);
  await playCompletionSound({
    ...options,
    src,
  });
}

export function showTurnCompletionNotification(
  input: ShowTurnCompletionNotificationInput,
): Notification | null {
  if (getNotificationPermissionState() !== "granted" || typeof Notification === "undefined") {
    return null;
  }

  const copy = getNotificationCopy(input.settledTurn);
  try {
    const notification = new Notification(copy.title, {
      body: copy.body,
      tag: `agent-completion:${input.settledTurn.threadId}:${input.settledTurn.turnId}`,
    });
    notification.addEventListener("click", () => {
      if (typeof window !== "undefined") {
        window.focus();
      }
      input.onOpenThread(input.settledTurn.threadId);
      notification.close();
    });
    return notification;
  } catch {
    return null;
  }
}

export async function dispatchTurnCompletionEffects(
  input: DispatchTurnCompletionEffectsInput,
): Promise<void> {
  if (!input.backgrounded) {
    return;
  }

  if (input.settings.enableSystemNotifications) {
    showTurnCompletionNotification({
      settledTurn: input.settledTurn,
      onOpenThread: input.onOpenThread,
    });
  }

  if (input.settings.enableCompletionSound) {
    await playConfiguredCompletionSound(input.settings, {
      swallowErrors: true,
    });
  }
}
