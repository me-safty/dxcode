import {
  DesktopNotificationDeliveryStatusSchema,
  DesktopNotificationEventSchema,
  DesktopNotificationTargetSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopNotifications from "../../notifications/DesktopNotifications.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const showDesktopNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SHOW_DESKTOP_NOTIFICATION_CHANNEL,
  payload: DesktopNotificationEventSchema,
  result: DesktopNotificationDeliveryStatusSchema,
  handler: Effect.fn("desktop.ipc.notifications.show")(function* (event) {
    const notifications = yield* DesktopNotifications.DesktopNotifications;
    return yield* notifications.show(event);
  }),
});

export const consumePendingDesktopNotificationTarget = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONSUME_DESKTOP_NOTIFICATION_TARGET_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopNotificationTargetSchema),
  handler: Effect.fn("desktop.ipc.notifications.consumeTarget")(function* () {
    const notifications = yield* DesktopNotifications.DesktopNotifications;
    return Option.getOrNull(yield* notifications.consumePendingTarget);
  }),
});
