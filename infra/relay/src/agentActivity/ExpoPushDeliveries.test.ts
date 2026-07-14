import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";

import type * as LiveActivities from "./LiveActivities.ts";
import {
  ANDROID_ACTIVITY_CHANNEL_ID,
  ANDROID_ALERTS_CHANNEL_ID,
  messagesForAndroidTarget,
} from "./ExpoPushDeliveries.ts";

const NOW_MS = Date.parse("2026-07-13T00:00:30.000Z");

const preferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

function target(overrides: Partial<LiveActivities.TargetRow> = {}): LiveActivities.TargetRow {
  return {
    user_id: "user-1",
    device_id: "device-1",
    platform: "android",
    ios_major_version: null,
    android_api_level: 36,
    app_version: "1.0.0",
    bundle_id: null,
    aps_environment: null,
    push_token: null,
    expo_push_token: "ExponentPushToken[test]",
    push_to_start_token: null,
    preferences_json: JSON.stringify(preferences),
    activity_push_token: null,
    remote_start_queued_at: null,
    remote_started_at: null,
    ended_at: null,
    last_aggregate_json: null,
    last_live_activity_delivery_at: null,
    ...overrides,
  };
}

type AggregatePhase = "running" | "waiting_for_approval" | "completed";

function row(phase: AggregatePhase, threadId = "thread") {
  return {
    environmentId: "env" as RelayAgentActivityAggregateState["activities"][number]["environmentId"],
    threadId: threadId as RelayAgentActivityAggregateState["activities"][number]["threadId"],
    projectTitle: "Project",
    threadTitle: threadId === "thread" ? "Thread" : "Second thread",
    modelTitle: "Fable 5",
    phase,
    status: phase === "running" ? "Working" : phase === "completed" ? "Done" : "Approval",
    updatedAt: "2026-07-13T00:00:00.000Z",
    deepLink: `/threads/env/${threadId}`,
  };
}

function aggregate(
  phase: AggregatePhase,
  overrides: Partial<RelayAgentActivityAggregateState> = {},
): RelayAgentActivityAggregateState {
  return {
    title: "T3 Code",
    subtitle: "Agent work in progress",
    activeCount: phase === "completed" ? 0 : 1,
    updatedAt: "2026-07-13T00:00:00.000Z",
    activities: [row(phase)],
    ...overrides,
  };
}

function withBaseline(
  baseline: RelayAgentActivityAggregateState,
  overrides: Partial<LiveActivities.TargetRow> = {},
): LiveActivities.TargetRow {
  return target({
    last_aggregate_json: JSON.stringify(baseline),
    last_live_activity_delivery_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  });
}

describe("messagesForAndroidTarget", () => {
  it("sends a quiet status without an alert for a fresh baseline", () => {
    const { status, alert, baselineRefresh } = messagesForAndroidTarget({
      target: target(),
      aggregate: aggregate("waiting_for_approval"),
      nowMs: NOW_MS,
    });

    // No baseline means reconnect/registration replay: repaint, never ring.
    expect(alert).toBeNull();
    expect(baselineRefresh).toBe(false);
    expect(status).toMatchObject({
      channelId: ANDROID_ACTIVITY_CHANNEL_ID,
      tag: "t3-connect-agent-status",
      collapseId: "t3-connect-agent-status",
      priority: "default",
      data: { deepLink: "/threads/env/thread" },
    });
  });

  it("alerts on an attention transition and repaints the status alongside", () => {
    const { status, alert } = messagesForAndroidTarget({
      target: withBaseline(aggregate("running")),
      aggregate: aggregate("waiting_for_approval"),
      nowMs: NOW_MS,
    });

    expect(alert).toMatchObject({
      channelId: ANDROID_ALERTS_CHANNEL_ID,
      tag: "t3-connect-agent-alert",
      collapseId: "t3-connect-agent-alert",
      priority: "high",
      sound: "default",
      title: "Thread",
      body: "Approval: Project",
    });
    // The shade must not keep stale "Working" content beside the alert.
    expect(status).toMatchObject({
      channelId: ANDROID_ACTIVITY_CHANNEL_ID,
      priority: "default",
    });
  });

  it("does not re-alert when the same attention aggregate is republished", () => {
    const approval = aggregate("waiting_for_approval");
    const { status, alert } = messagesForAndroidTarget({
      target: withBaseline(approval),
      aggregate: approval,
      nowMs: NOW_MS,
    });

    expect(alert).toBeNull();
    expect(status).toBeNull();
  });

  it("alerts on a fresh completion transition", () => {
    const { alert } = messagesForAndroidTarget({
      target: withBaseline(aggregate("running")),
      aggregate: aggregate("completed"),
      nowMs: NOW_MS,
    });

    expect(alert).toMatchObject({
      channelId: ANDROID_ALERTS_CHANNEL_ID,
      title: "Thread",
      body: "Done: Project",
    });
  });

  it("stays silent for stale completion replays", () => {
    const staleNowMs = Date.parse("2026-07-13T01:00:00.000Z");
    const { alert } = messagesForAndroidTarget({
      target: withBaseline(aggregate("running")),
      aggregate: aggregate("completed"),
      nowMs: staleNowMs,
    });

    expect(alert).toBeNull();
  });

  it("alerts for a transition on a non-first aggregate row", () => {
    const previous: RelayAgentActivityAggregateState = {
      ...aggregate("running"),
      activeCount: 2,
      activities: [row("running"), row("running", "thread-2")],
    };
    const next: RelayAgentActivityAggregateState = {
      ...previous,
      activities: [row("running"), row("waiting_for_approval", "thread-2")],
    };

    const { alert } = messagesForAndroidTarget({
      target: withBaseline(previous),
      aggregate: next,
      nowMs: NOW_MS,
    });

    expect(alert).toMatchObject({
      title: "Second thread",
      body: "Approval: Project",
      data: {
        threadId: "thread-2",
        deepLink: "/threads/env/thread-2",
      },
    });
  });

  it("suppresses phase-preference-disabled alerts but keeps the status", () => {
    const disabledApprovals = withBaseline(aggregate("running"), {
      preferences_json: JSON.stringify({ ...preferences, notifyOnApproval: false }),
    });
    const { status, alert } = messagesForAndroidTarget({
      target: disabledApprovals,
      aggregate: aggregate("waiting_for_approval"),
      nowMs: NOW_MS,
    });

    expect(alert).toBeNull();
    expect(status).not.toBeNull();
  });

  it("alerts without a status when live updates are disabled, then refreshes silently", () => {
    const noLiveUpdates = {
      preferences_json: JSON.stringify({ ...preferences, liveActivitiesEnabled: false }),
    };
    const transition = messagesForAndroidTarget({
      target: withBaseline(aggregate("running"), noLiveUpdates),
      aggregate: aggregate("waiting_for_approval"),
      nowMs: NOW_MS,
    });
    expect(transition.alert).toMatchObject({ channelId: ANDROID_ALERTS_CHANNEL_ID });
    expect(transition.status).toBeNull();

    // Quiet drift with no status channel: nothing to send, but the baseline
    // must advance or a later re-approval would never alert.
    const drift = messagesForAndroidTarget({
      target: withBaseline(aggregate("waiting_for_approval"), noLiveUpdates),
      aggregate: aggregate("running"),
      nowMs: NOW_MS,
    });
    expect(drift.alert).toBeNull();
    expect(drift.status).toBeNull();
    expect(drift.baselineRefresh).toBe(true);
  });

  it("sends the final quiet status only on the transition to no activity", () => {
    const ended = messagesForAndroidTarget({
      target: withBaseline(aggregate("running")),
      aggregate: null,
      nowMs: NOW_MS,
    });
    expect(ended.status).toMatchObject({
      channelId: ANDROID_ACTIVITY_CHANNEL_ID,
      tag: "t3-connect-agent-status",
      title: "T3 Code",
      body: "No active agents",
    });

    const alreadyEmpty = messagesForAndroidTarget({
      target: target(),
      aggregate: null,
      nowMs: NOW_MS,
    });
    expect(alreadyEmpty.status).toBeNull();
    expect(alreadyEmpty.alert).toBeNull();
    expect(alreadyEmpty.baselineRefresh).toBe(false);
  });

  it("throttles quiet content drift inside the minimum update interval", () => {
    const drifted = {
      ...aggregate("running"),
      updatedAt: "2026-07-13T00:00:20.000Z",
    };
    const throttled = messagesForAndroidTarget({
      target: withBaseline(aggregate("running"), {
        last_live_activity_delivery_at: "2026-07-13T00:00:25.000Z",
      }),
      aggregate: drifted,
      nowMs: NOW_MS,
    });
    expect(throttled.status).toBeNull();

    const dueAgain = messagesForAndroidTarget({
      target: withBaseline(aggregate("running"), {
        last_live_activity_delivery_at: "2026-07-13T00:00:00.000Z",
      }),
      aggregate: drifted,
      nowMs: NOW_MS,
    });
    expect(dueAgain.status).not.toBeNull();
  });

  it("sends nothing for devices without an Expo token or for iOS rows", () => {
    expect(
      messagesForAndroidTarget({
        target: target({ expo_push_token: null }),
        aggregate: aggregate("waiting_for_approval"),
        nowMs: NOW_MS,
      }),
    ).toEqual({ status: null, alert: null, baselineRefresh: false });
    expect(
      messagesForAndroidTarget({
        target: target({ platform: "ios", push_token: "apns" }),
        aggregate: aggregate("waiting_for_approval"),
        nowMs: NOW_MS,
      }),
    ).toEqual({ status: null, alert: null, baselineRefresh: false });
  });
});
