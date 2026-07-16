import {
  EnvironmentId,
  ThreadId,
  TurnId,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE,
  reduceDesktopNotificationObservation,
  type DesktopNotificationThread,
  type DesktopNotificationTrackerState,
} from "./desktopNotifications.logic";

const ENVIRONMENT_ID = EnvironmentId.make("primary");
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

function makeThread(
  input: {
    readonly turnState?: "running" | "interrupted" | "completed" | "error" | null;
    readonly sessionStatus?: OrchestrationSessionStatus;
    readonly approval?: boolean;
    readonly userInput?: boolean;
    readonly archived?: boolean;
    readonly updatedAt?: string;
  } = {},
): DesktopNotificationThread {
  const turnState = input.turnState ?? null;
  return {
    id: THREAD_ID,
    updatedAt: input.updatedAt ?? "2026-07-14T10:00:00.000Z",
    archivedAt: input.archived ? "2026-07-14T10:00:00.000Z" : null,
    latestTurn:
      turnState === null
        ? null
        : {
            turnId: TURN_ID,
            state: turnState,
            requestedAt: "2026-07-14T09:59:00.000Z",
            startedAt: "2026-07-14T09:59:01.000Z",
            completedAt: turnState === "running" ? null : "2026-07-14T10:00:00.000Z",
            assistantMessageId: null,
          },
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId: THREAD_ID,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: input.sessionStatus === "running" ? TURN_ID : null,
            lastError: null,
            updatedAt: "2026-07-14T10:00:00.000Z",
          },
    hasPendingApprovals: input.approval ?? false,
    hasPendingUserInput: input.userInput ?? false,
  };
}

function observe(
  state: DesktopNotificationTrackerState,
  threads: ReadonlyArray<DesktopNotificationThread>,
  syncKey = "1:1",
) {
  return reduceDesktopNotificationObservation(state, {
    active: true,
    syncKey,
    environmentId: ENVIRONMENT_ID,
    threads,
  });
}

function baseline(thread: DesktopNotificationThread) {
  return observe(EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE, [thread]).state;
}

describe("desktop notification transition reduction", () => {
  it("reduce_bootstrapWithAttention_emitsNothing", () => {
    const result = observe(EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE, [
      makeThread({ turnState: "completed", approval: true, userInput: true }),
    ]);
    expect(result.events).toEqual([]);
  });

  it("reduce_runningToCompleted_emitsOnce", () => {
    const running = makeThread({ sessionStatus: "running" });
    const settling = makeThread({ sessionStatus: "ready" });
    const completed = makeThread({ turnState: "completed", sessionStatus: "ready" });
    const intermediate = observe(baseline(running), [settling]);
    const result = observe(intermediate.state, [completed]);
    expect(intermediate.events).toEqual([]);
    expect(result.events.map((event) => event.kind)).toEqual(["turn-completed"]);
    expect(observe(result.state, [completed]).events).toEqual([]);
  });

  it("reduce_runningToError_emitsOnce", () => {
    const running = makeThread({ sessionStatus: "running" });
    const failed = makeThread({ turnState: "error", sessionStatus: "error" });
    expect(observe(baseline(running), [failed]).events.map((event) => event.kind)).toEqual([
      "turn-failed",
    ]);
  });

  it("reduce_newApprovalAndInput_emitsEachOnce", () => {
    const idle = makeThread();
    const pending = makeThread({
      approval: true,
      userInput: true,
      updatedAt: "2026-07-14T10:01:00.000Z",
    });
    const result = observe(baseline(idle), [pending]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "approval-required",
      "user-input-required",
    ]);
    expect(observe(result.state, [pending]).events).toEqual([]);
  });

  it("reduce_reconnectOrReseed_rebaselinesWithoutEvents", () => {
    const running = makeThread({ turnState: "running", sessionStatus: "running" });
    const completed = makeThread({ turnState: "completed", sessionStatus: "ready" });
    const state = baseline(running);
    expect(observe(state, [completed], "2:1").events).toEqual([]);
    expect(observe(state, [completed], "1:2").events).toEqual([]);
  });

  it("reduce_archivedOrRemoved_suppressesEvents", () => {
    const running = makeThread({ turnState: "running", sessionStatus: "running" });
    const state = baseline(running);
    expect(observe(state, [makeThread({ turnState: "completed", archived: true })]).events).toEqual(
      [],
    );
    expect(observe(state, []).events).toEqual([]);
  });

  it("reduce_partialSettledThread_emitsNothing", () => {
    const result = observe(baseline(makeThread()), [makeThread({ turnState: "completed" })]);
    expect(result.events).toEqual([]);
  });

  it("reduce_inactive_resetsTracker", () => {
    const state = baseline(makeThread({ turnState: "running", sessionStatus: "running" }));
    const result = reduceDesktopNotificationObservation(state, {
      active: false,
      syncKey: "1:1",
      environmentId: ENVIRONMENT_ID,
      threads: [],
    });
    expect(result).toEqual({ state: EMPTY_DESKTOP_NOTIFICATION_TRACKER_STATE, events: [] });
  });
});
