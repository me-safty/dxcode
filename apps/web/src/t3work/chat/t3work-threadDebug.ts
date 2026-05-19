const DEFAULT_MAX_T3WORK_THREAD_DEBUG_EVENTS = 500;

export type T3WorkThreadDebugEvent = {
  at: string;
  name: string;
  payload: Record<string, unknown>;
};

declare global {
  var __T3WORK_THREAD_DEBUG_EVENTS__: T3WorkThreadDebugEvent[] | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return value === null ? null : String(value);
}

export function appendT3WorkThreadDebugEvent(
  events: ReadonlyArray<T3WorkThreadDebugEvent>,
  event: T3WorkThreadDebugEvent,
  maxEvents = DEFAULT_MAX_T3WORK_THREAD_DEBUG_EVENTS,
): T3WorkThreadDebugEvent[] {
  const nextEvents = [...events, event];
  return nextEvents.length <= maxEvents
    ? nextEvents
    : nextEvents.slice(nextEvents.length - maxEvents);
}

export function summarizeT3WorkThreadEvent(event: unknown): Record<string, unknown> {
  if (!isRecord(event)) {
    return { value: asPrimitive(event) };
  }

  const summary: Record<string, unknown> = {};

  for (const key of [
    "type",
    "_tag",
    "threadId",
    "projectId",
    "turnId",
    "messageId",
    "commandId",
    "sessionId",
    "status",
    "reason",
    "channel",
  ]) {
    const value = event[key];
    if (value !== undefined) {
      summary[key] = asPrimitive(value);
    }
  }

  if (summary.type === undefined && summary._tag === undefined) {
    summary.keys = Object.keys(event).slice(0, 8);
  }

  return summary;
}

export function summarizeT3WorkServerThread(thread: unknown): Record<string, unknown> | null {
  if (!isRecord(thread)) {
    return null;
  }

  const latestTurn = isRecord(thread.latestTurn) ? thread.latestTurn : null;
  const session = isRecord(thread.session) ? thread.session : null;

  return {
    id: typeof thread.id === "string" ? thread.id : null,
    projectId: typeof thread.projectId === "string" ? thread.projectId : null,
    title: typeof thread.title === "string" ? thread.title : null,
    messageCount: Array.isArray(thread.messages) ? thread.messages.length : null,
    latestTurnId: latestTurn && typeof latestTurn.turnId === "string" ? latestTurn.turnId : null,
    sessionStatus: session && typeof session.status === "string" ? session.status : null,
    archivedAt: typeof thread.archivedAt === "string" ? thread.archivedAt : null,
    error: typeof thread.error === "string" ? thread.error : null,
  };
}

function isVerboseConsoleEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem("t3work:thread-debug") === "1";
  } catch {
    return false;
  }
}

export function recordT3WorkThreadDebug(name: string, payload: Record<string, unknown> = {}): void {
  const nextEvent: T3WorkThreadDebugEvent = {
    at: new Date().toISOString(),
    name,
    payload,
  };

  const currentEvents = Array.isArray(globalThis.__T3WORK_THREAD_DEBUG_EVENTS__)
    ? globalThis.__T3WORK_THREAD_DEBUG_EVENTS__
    : [];

  globalThis.__T3WORK_THREAD_DEBUG_EVENTS__ = appendT3WorkThreadDebugEvent(
    currentEvents,
    nextEvent,
  );

  if (isVerboseConsoleEnabled()) {
    console.debug("[t3work-thread]", name, payload);
  }
}
