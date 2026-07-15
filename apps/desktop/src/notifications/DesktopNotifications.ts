import type {
  DesktopNotificationDeliveryStatus,
  DesktopNotificationEvent,
  DesktopNotificationKind,
  DesktopNotificationTarget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronNotification from "../electron/ElectronNotification.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { DESKTOP_NOTIFICATION_TARGET_AVAILABLE_CHANNEL } from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

const MAX_HANDLED_EVENTS = 512;
const NOTIFICATION_TITLE = "T3 Code needs your attention";
const NOTIFICATION_BODY: Record<DesktopNotificationKind, string> = {
  "turn-completed": "A turn completed.",
  "turn-failed": "A turn failed.",
  "approval-required": "An approval is required.",
  "user-input-required": "Your response is required.",
};

const { logWarning } = DesktopObservability.makeComponentLogger("desktop-notifications");

export class DesktopNotifications extends Context.Service<
  DesktopNotifications,
  {
    readonly show: (
      event: DesktopNotificationEvent,
    ) => Effect.Effect<DesktopNotificationDeliveryStatus>;
    readonly consumePendingTarget: Effect.Effect<Option.Option<DesktopNotificationTarget>>;
  }
>()("@t3tools/desktop/notifications/DesktopNotifications") {}

function rememberEvent(eventIds: Set<string>, eventId: string): void {
  eventIds.add(eventId);
  while (eventIds.size > MAX_HANDLED_EVENTS) {
    const oldest = eventIds.values().next().value;
    if (oldest === undefined) return;
    eventIds.delete(oldest);
  }
}

function windowIsFocused(window: Electron.BrowserWindow): boolean {
  try {
    return !window.isDestroyed() && window.isFocused();
  } catch {
    return true;
  }
}

export const make = Effect.gen(function* () {
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronNotification = yield* ElectronNotification.ElectronNotification;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const pendingTarget = yield* Ref.make<Option.Option<DesktopNotificationTarget>>(Option.none());
  const handledEvents = new Set<string>();
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const runFork = Effect.runForkWith(context);

  const handleClick = (event: DesktopNotificationEvent) => {
    runFork(
      Ref.set(
        pendingTarget,
        Option.some({ environmentId: event.environmentId, threadId: event.threadId }),
      ).pipe(
        Effect.andThen(
          desktopWindow.dispatchRendererEvent(DESKTOP_NOTIFICATION_TARGET_AVAILABLE_CHANNEL),
        ),
        Effect.catch(() => logWarning("notification click handling failed")),
      ),
    );
  };

  const show = Effect.fn("desktop.notifications.show")(function* (
    event: DesktopNotificationEvent,
  ): Effect.fn.Return<DesktopNotificationDeliveryStatus> {
    if (handledEvents.has(event.eventId)) return "duplicate";
    rememberEvent(handledEvents, event.eventId);
    const settings = yield* clientSettings.get;
    if (!Option.exists(settings, (value) => value.desktopNotificationsEnabled)) return "disabled";
    const mainWindow = yield* electronWindow.main;
    if (Option.exists(mainWindow, windowIsFocused)) return "focused";
    const supported = yield* electronNotification.isSupported.pipe(
      Effect.orElseSucceed(() => false),
    );
    if (!supported) return "unsupported";
    return yield* electronNotification
      .show({
        key: event.eventId,
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY[event.kind],
        silent: true,
        onClick: () => handleClick(event),
        onFailed: () => runFork(logWarning("native notification delivery failed")),
      })
      .pipe(
        Effect.as<DesktopNotificationDeliveryStatus>("shown"),
        Effect.orElseSucceed(() => "failed" as const),
      );
  });

  return DesktopNotifications.of({
    show,
    consumePendingTarget: Ref.getAndSet(pendingTarget, Option.none()),
  });
});

export const layer = Layer.effect(DesktopNotifications, make);
