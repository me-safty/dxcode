import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayDeliveryResult,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  alertAllowedForPhase,
  parseAgentAwarenessPreferences,
} from "./agentAwarenessPreferences.ts";
import * as DeliveryAttempts from "./DeliveryAttempts.ts";
import * as Devices from "./Devices.ts";
import * as ExpoPush from "./ExpoPushClient.ts";
import type * as LiveActivities from "./LiveActivities.ts";

const STATUS_NOTIFICATION_TAG = "t3-connect-agent-status";
const STATUS_COLLAPSE_ID = "t3-connect-agent-status";
const ALERT_NOTIFICATION_TAG = "t3-connect-agent-alert";
const ALERT_COLLAPSE_ID = "t3-connect-agent-alert";
export const ANDROID_ACTIVITY_CHANNEL_ID = "t3-connect-activity";
export const ANDROID_ALERTS_CHANNEL_ID = "t3-connect-alerts";

export function messageForAndroidTarget(input: {
  readonly target: LiveActivities.TargetRow;
  readonly aggregate: RelayAgentActivityAggregateState | null;
  readonly eventState: RelayAgentActivityState | null;
}): ExpoPush.ExpoPushMessage | null {
  const expoPushToken = input.target.expo_push_token;
  if (input.target.platform !== "android" || !expoPushToken) {
    return null;
  }
  const preferences = parseAgentAwarenessPreferences(input.target.preferences_json);
  if (!preferences) return null;

  if (input.aggregate === null) {
    return preferences.liveActivitiesEnabled
      ? {
          to: expoPushToken,
          title: "T3 Code",
          body: "No active agents",
          data: { notificationKind: "agent-awareness" },
          channelId: ANDROID_ACTIVITY_CHANNEL_ID,
          tag: STATUS_NOTIFICATION_TAG,
          collapseId: STATUS_COLLAPSE_ID,
          priority: "default",
        }
      : null;
  }

  const activity = input.aggregate.activities[0];
  if (!activity) return null;

  const alertState =
    input.eventState !== null &&
    preferences.notificationsEnabled &&
    alertAllowedForPhase(preferences, input.eventState.phase)
      ? input.eventState
      : null;
  if (!preferences.liveActivitiesEnabled && alertState === null) return null;

  const title = alertState ? alertState.threadTitle : input.aggregate.title;
  const body = alertState
    ? `${alertState.headline}: ${alertState.projectTitle}`
    : input.aggregate.activeCount > 1
      ? `${input.aggregate.activeCount} agents active · ${activity.threadTitle}`
      : `${activity.status}: ${activity.threadTitle} · ${activity.projectTitle}`;
  const navigationState = alertState ?? activity;

  return {
    to: expoPushToken,
    title,
    body,
    data: {
      environmentId: navigationState.environmentId,
      threadId: navigationState.threadId,
      deepLink: navigationState.deepLink,
      notificationKind: "agent-awareness",
    },
    channelId: alertState ? ANDROID_ALERTS_CHANNEL_ID : ANDROID_ACTIVITY_CHANNEL_ID,
    tag: alertState ? ALERT_NOTIFICATION_TAG : STATUS_NOTIFICATION_TAG,
    collapseId: alertState ? ALERT_COLLAPSE_ID : STATUS_COLLAPSE_ID,
    priority: alertState ? "high" : "default",
    ...(alertState ? { sound: "default" as const } : {}),
  };
}

export type ExpoPushDeliveryError = DeliveryAttempts.DeliveryAttemptRecordPersistenceError;

export class ExpoPushDeliveries extends Context.Service<
  ExpoPushDeliveries,
  {
    readonly sendForTarget: (input: {
      readonly target: LiveActivities.TargetRow;
      readonly aggregate: RelayAgentActivityAggregateState | null;
      readonly eventState: RelayAgentActivityState | null;
    }) => Effect.Effect<RelayDeliveryResult | null, ExpoPushDeliveryError>;
    readonly reconcileReceipts: Effect.Effect<void, ExpoPushDeliveryError>;
  }
>()("t3code-relay/agentActivity/ExpoPushDeliveries") {}

export const make = Effect.gen(function* () {
  const client = yield* ExpoPush.ExpoPushClient;
  const attempts = yield* DeliveryAttempts.DeliveryAttempts;
  const devices = yield* Devices.Devices;

  return ExpoPushDeliveries.of({
    reconcileReceipts: Effect.gen(function* () {
      const now = yield* DateTime.now;
      const pending = yield* attempts.listPendingExpoReceipts({
        createdAfter: DateTime.formatIso(DateTime.subtract(now, { hours: 24 })),
        createdBefore: DateTime.formatIso(DateTime.subtract(now, { minutes: 15 })),
        limit: 1_000,
      });
      if (pending.length === 0) return;

      const receipts = yield* client
        .getReceipts(pending.map((item) => item.providerId))
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              "Could not read Expo push receipts; the next cron run will retry.",
            ).pipe(Effect.annotateLogs({ error }), Effect.as(null)),
          ),
        );
      if (receipts === null) return;

      yield* Effect.forEach(
        pending,
        (item) => {
          const receipt = receipts[item.providerId];
          if (receipt === undefined) return Effect.void;
          const reason = receipt.errorCode ?? receipt.reason;
          return attempts
            .completeExpoReceipt({
              providerId: item.providerId,
              status: receipt.status,
              reason,
            })
            .pipe(
              Effect.andThen(
                receipt.errorCode === "DeviceNotRegistered" &&
                  item.userId !== null &&
                  item.deviceId !== null &&
                  item.tokenSuffix !== null
                  ? devices
                      .invalidateExpoPushTokenSuffix({
                        userId: item.userId,
                        deviceId: item.deviceId,
                        tokenSuffix: item.tokenSuffix,
                      })
                      .pipe(
                        Effect.catch((error) =>
                          Effect.logWarning(
                            "Could not invalidate an Expo token rejected by a receipt.",
                          ).pipe(Effect.annotateLogs({ error })),
                        ),
                      )
                  : Effect.void,
              ),
            );
        },
        { concurrency: 8, discard: true },
      );
    }),
    sendForTarget: Effect.fn("relay.expo_push_deliveries.send_for_target")(function* (input) {
      const message = messageForAndroidTarget(input);
      if (message === null) return null;

      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.target.device_id,
        "relay.delivery.kind": "push_notification",
        "relay.delivery.provider": "expo",
      });
      const ticket = yield* client.send(message).pipe(
        Effect.catch((error) =>
          Effect.logError(error.message).pipe(
            Effect.annotateLogs({
              error,
              "relay.mobile.device_id": input.target.device_id,
              "relay.delivery.provider": "expo",
            }),
            Effect.as({
              ok: false,
              id: null,
              status: "transport_error",
              reason: error.message,
              errorCode: null,
            } satisfies ExpoPush.ExpoPushTicket),
          ),
        ),
      );
      const reason = ticket.errorCode ?? ticket.reason;
      yield* attempts.record({
        userId: input.target.user_id,
        environmentId: message.data.environmentId ?? null,
        threadId: message.data.threadId ?? null,
        deviceId: input.target.device_id,
        kind: "push_notification",
        token: message.to,
        deliveryProvider: "expo",
        providerStatus: ticket.status,
        ...(reason ? { providerReason: reason } : {}),
        providerId: ticket.id,
        ...(ticket.ok ? {} : { transportError: reason ?? "Expo rejected the push ticket." }),
      });
      if (ticket.errorCode === "DeviceNotRegistered") {
        yield* devices
          .invalidateExpoPushToken({
            userId: input.target.user_id,
            deviceId: input.target.device_id,
            expoPushToken: message.to,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not invalidate a rejected Expo push token.").pipe(
                Effect.annotateLogs({ error }),
              ),
            ),
          );
      }
      return {
        deviceId: input.target.device_id,
        kind: "push_notification" as const,
        ok: ticket.ok,
        queued: ticket.ok,
        apnsStatus: null,
        apnsReason: null,
        apnsId: null,
        provider: "expo" as const,
        providerStatus: ticket.status,
        providerReason: reason,
        providerId: ticket.id,
      };
    }),
  });
});

export const layer = Layer.effect(ExpoPushDeliveries, make);
