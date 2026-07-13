import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";

import type * as LiveActivities from "./LiveActivities.ts";
import {
  ANDROID_ACTIVITY_CHANNEL_ID,
  ANDROID_ALERTS_CHANNEL_ID,
  messageForAndroidTarget,
} from "./ExpoPushDeliveries.ts";

const preferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

function target(): LiveActivities.TargetRow {
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
  };
}

function aggregate(phase: "running" | "waiting_for_approval"): RelayAgentActivityAggregateState {
  return {
    title: "T3 Code",
    subtitle: "Agent work in progress",
    activeCount: 1,
    updatedAt: "2026-07-13T00:00:00.000Z",
    activities: [
      {
        environmentId:
          "env" as RelayAgentActivityAggregateState["activities"][number]["environmentId"],
        threadId: "thread" as RelayAgentActivityAggregateState["activities"][number]["threadId"],
        projectTitle: "Project",
        threadTitle: "Thread",
        modelTitle: "Fable 5",
        phase,
        status: phase === "running" ? "Working" : "Approval",
        updatedAt: "2026-07-13T00:00:00.000Z",
        deepLink: "/threads/env/thread",
      },
    ],
  };
}

function eventState(
  phase: "running" | "waiting_for_approval",
  threadId = "thread",
): RelayAgentActivityState {
  return {
    environmentId: "env" as RelayAgentActivityState["environmentId"],
    threadId: threadId as RelayAgentActivityState["threadId"],
    projectTitle: "Project",
    threadTitle: threadId === "thread" ? "Thread" : "Second thread",
    modelTitle: "Fable 5",
    phase,
    headline: phase === "running" ? "Running" : "Approval needed",
    updatedAt: "2026-07-13T00:00:00.000Z",
    deepLink: `/threads/env/${threadId}`,
  };
}

describe("ExpoPushDeliveries", () => {
  it("uses the quiet replaceable channel for live status", () => {
    expect(
      messageForAndroidTarget({
        target: target(),
        aggregate: aggregate("running"),
        eventState: eventState("running"),
      }),
    ).toMatchObject({
      channelId: ANDROID_ACTIVITY_CHANNEL_ID,
      tag: "t3-connect-agent-status",
      collapseId: "t3-connect-agent-status",
      priority: "default",
      data: { deepLink: "/threads/env/thread" },
    });
  });

  it("uses the alert channel for an enabled approval notification", () => {
    expect(
      messageForAndroidTarget({
        target: target(),
        aggregate: aggregate("waiting_for_approval"),
        eventState: eventState("waiting_for_approval"),
      }),
    ).toMatchObject({
      channelId: ANDROID_ALERTS_CHANNEL_ID,
      tag: "t3-connect-agent-alert",
      collapseId: "t3-connect-agent-alert",
      priority: "high",
      sound: "default",
      title: "Thread",
    });
  });

  it("suppresses routine status when live updates are disabled", () => {
    const disabled = {
      ...target(),
      preferences_json: JSON.stringify({ ...preferences, liveActivitiesEnabled: false }),
    };
    expect(
      messageForAndroidTarget({
        target: disabled,
        aggregate: aggregate("running"),
        eventState: eventState("running"),
      }),
    ).toBeNull();
  });

  it("uses the current event for alerts when another agent is first in the aggregate", () => {
    const multiAgentAggregate = aggregate("running");
    const message = messageForAndroidTarget({
      target: target(),
      aggregate: { ...multiAgentAggregate, activeCount: 2 },
      eventState: eventState("waiting_for_approval", "thread-2"),
    });

    expect(message).toMatchObject({
      channelId: ANDROID_ALERTS_CHANNEL_ID,
      title: "Second thread",
      body: "Approval needed: Project",
      data: {
        threadId: "thread-2",
        deepLink: "/threads/env/thread-2",
      },
    });
  });

  it("sends a quiet final status to replace stale active-agent content", () => {
    expect(
      messageForAndroidTarget({ target: target(), aggregate: null, eventState: null }),
    ).toMatchObject({
      channelId: ANDROID_ACTIVITY_CHANNEL_ID,
      tag: "t3-connect-agent-status",
      title: "T3 Code",
      body: "No active agents",
    });
  });
});
