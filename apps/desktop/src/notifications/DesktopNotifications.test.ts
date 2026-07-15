import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type DesktopNotificationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronNotification from "../electron/ElectronNotification.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { DESKTOP_NOTIFICATION_TARGET_AVAILABLE_CHANNEL } from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopNotifications from "./DesktopNotifications.ts";

const event: DesktopNotificationEvent = {
  eventId: "primary:thread-1:turn-completed:turn-1",
  kind: "turn-completed",
  environmentId: EnvironmentId.make("primary"),
  threadId: ThreadId.make("thread-1"),
};

interface HarnessOptions {
  readonly enabled?: boolean;
  readonly focused?: boolean;
  readonly focusThrows?: boolean;
  readonly supported?: boolean;
  readonly showFails?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const shown: ElectronNotification.ElectronNotificationInput[] = [];
  const dispatchedChannels: string[] = [];
  const mainWindow = {
    isDestroyed: () => false,
    isFocused: () => {
      if (options.focusThrows) throw new Error("focus unavailable");
      return options.focused ?? false;
    },
  } as Electron.BrowserWindow;
  const notificationLayer = Layer.succeed(ElectronNotification.ElectronNotification, {
    isSupported: Effect.succeed(options.supported ?? true),
    show: (input) => {
      if (options.showFails) {
        return Effect.fail(
          new ElectronNotification.ElectronNotificationError({
            operation: "show",
            cause: new Error("permission denied"),
          }),
        );
      }
      return Effect.sync(() => shown.push(input)).pipe(Effect.asVoid);
    },
  } satisfies ElectronNotification.ElectronNotification["Service"]);
  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: () => Effect.die("unexpected create"),
    main: Effect.succeed(Option.some(mainWindow)),
    currentMainOrFirst: Effect.succeed(Option.some(mainWindow)),
    focusedMainOrFirst: Effect.succeed(Option.some(mainWindow)),
    setMain: () => Effect.void,
    clearMain: () => Effect.void,
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: () => Effect.void,
  } satisfies ElectronWindow.ElectronWindow["Service"]);
  const desktopWindowLayer = Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected create"),
    ensureMain: Effect.die("unexpected ensure"),
    revealOrCreateMain: Effect.die("unexpected reveal"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    showConnectingSplash: Effect.void,
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    dispatchMenuAction: () => Effect.void,
    dispatchRendererEvent: (channel) =>
      Effect.sync(() => {
        dispatchedChannels.push(channel);
      }),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindow["Service"]);
  const settingsLayer = DesktopClientSettings.layerTest(
    Option.some({
      ...DEFAULT_CLIENT_SETTINGS,
      desktopNotificationsEnabled: options.enabled ?? true,
    }),
  );
  const layer = DesktopNotifications.layer.pipe(
    Layer.provideMerge(notificationLayer),
    Layer.provideMerge(electronWindowLayer),
    Layer.provideMerge(desktopWindowLayer),
    Layer.provideMerge(settingsLayer),
  );
  return { layer, shown, dispatchedChannels };
}

describe("DesktopNotifications", () => {
  it.effect("show_unfocusedEnabled_deliversGenericSilentNotificationOnce", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const notifications = yield* DesktopNotifications.DesktopNotifications;
      assert.equal(yield* notifications.show(event), "shown");
      assert.equal(yield* notifications.show(event), "duplicate");
      assert.lengthOf(harness.shown, 1);
      assert.deepInclude(harness.shown[0], {
        key: event.eventId,
        title: "T3 Code needs your attention",
        body: "A turn completed.",
        silent: true,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("show_disabledFocusedOrUnsupported_skipsDelivery", () =>
    Effect.gen(function* () {
      for (const [options, status] of [
        [{ enabled: false }, "disabled"],
        [{ focused: true }, "focused"],
        [{ focusThrows: true }, "focused"],
        [{ supported: false }, "unsupported"],
      ] as const) {
        const harness = makeHarness(options);
        assert.equal(
          yield* Effect.gen(function* () {
            const notifications = yield* DesktopNotifications.DesktopNotifications;
            return yield* notifications.show(event);
          }).pipe(Effect.provide(harness.layer)),
          status,
        );
        assert.lengthOf(harness.shown, 0);
      }
    }),
  );

  it.effect("show_permissionDenied_returnsFailedWithoutDefect", () => {
    const harness = makeHarness({ showFails: true });
    return Effect.gen(function* () {
      const notifications = yield* DesktopNotifications.DesktopNotifications;
      assert.equal(yield* notifications.show(event), "failed");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("click_notification_resolvesTargetExactlyOnce", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const notifications = yield* DesktopNotifications.DesktopNotifications;
      yield* notifications.show(event);
      harness.shown[0]?.onClick();
      yield* Effect.yieldNow;
      assert.deepEqual(
        yield* notifications.consumePendingTarget,
        Option.some({ environmentId: event.environmentId, threadId: event.threadId }),
      );
      assert.isTrue(Option.isNone(yield* notifications.consumePendingTarget));
      assert.deepEqual(harness.dispatchedChannels, [DESKTOP_NOTIFICATION_TARGET_AVAILABLE_CHANNEL]);
    }).pipe(Effect.provide(harness.layer));
  });
});
