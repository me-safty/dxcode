import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as EffectPath from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach } from "vitest";

import { DesktopBackendManager } from "../desktopBackendManager.ts";
import { makeDesktopEnvironment, DesktopEnvironment } from "../desktopEnvironment.ts";
import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "../desktopSettings.ts";
import * as DesktopSettingsState from "./DesktopSettingsState.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";

const originalMockUpdates = process.env.T3CODE_DESKTOP_MOCK_UPDATES;
const originalMockUpdatePort = process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT;

interface UpdatesHarness {
  readonly layer: Layer.Layer<
    DesktopUpdates.DesktopUpdates | DesktopSettingsState.DesktopSettingsState
  >;
  readonly checkCount: () => number;
  readonly feedUrls: () => readonly ElectronUpdater.ElectronUpdaterFeedUrl[];
  readonly listenerCount: () => number;
  readonly sentStates: readonly DesktopUpdateState[];
  readonly emit: (eventName: string, payload?: unknown) => void;
}

const flushCallbacks = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

function makeHarness(): UpdatesHarness {
  let checkCount = 0;
  let allowDowngrade = false;
  const feedUrls: ElectronUpdater.ElectronUpdaterFeedUrl[] = [];
  const listeners = new Map<string, Set<(...args: readonly unknown[]) => void>>();
  const sentStates: DesktopUpdateState[] = [];

  const addListener = (eventName: string, listener: (...args: readonly unknown[]) => void) => {
    const eventListeners = listeners.get(eventName) ?? new Set();
    eventListeners.add(listener);
    listeners.set(eventName, eventListeners);
  };

  const removeListener = (eventName: string, listener: (...args: readonly unknown[]) => void) => {
    const eventListeners = listeners.get(eventName);
    if (!eventListeners) {
      return;
    }
    eventListeners.delete(listener);
    if (eventListeners.size === 0) {
      listeners.delete(eventName);
    }
  };

  const updaterLayer = Layer.succeed(ElectronUpdater.ElectronUpdater, {
    setFeedURL: (options) =>
      Effect.sync(() => {
        feedUrls.push(options);
      }),
    setAutoDownload: () => Effect.void,
    setAutoInstallOnAppQuit: () => Effect.void,
    setChannel: () => Effect.void,
    setAllowPrerelease: () => Effect.void,
    allowDowngrade: Effect.sync(() => allowDowngrade),
    setAllowDowngrade: (value) =>
      Effect.sync(() => {
        allowDowngrade = value;
      }),
    setDisableDifferentialDownload: () => Effect.void,
    checkForUpdates: Effect.sync(() => {
      checkCount += 1;
    }),
    downloadUpdate: Effect.void,
    quitAndInstall: () => Effect.void,
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          addListener(eventName, listener as unknown as (...args: readonly unknown[]) => void);
        }),
        () =>
          Effect.sync(() => {
            removeListener(eventName, listener as unknown as (...args: readonly unknown[]) => void);
          }),
      ).pipe(Effect.asVoid),
  } satisfies ElectronUpdater.ElectronUpdaterShape);

  const windowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    main: Effect.succeed(Option.none()),
    currentMainOrFirst: Effect.succeed(Option.none()),
    focusedMainOrFirst: Effect.succeed(Option.none()),
    setMain: () => Effect.void,
    clearMain: () => Effect.void,
    reveal: () => Effect.void,
    sendAll: (_channel, state) =>
      Effect.sync(() => {
        sentStates.push(state as DesktopUpdateState);
      }),
    destroyAll: Effect.void,
    syncAllAppearance: () => Effect.void,
  } satisfies ElectronWindow.ElectronWindowShape);

  const backendLayer = Layer.succeed(DesktopBackendManager, {
    start: Effect.void,
    stop: () => Effect.void,
    shutdown: Effect.void,
    currentConfig: Effect.succeed(Option.none()),
    snapshot: Effect.succeed({
      desiredRunning: false,
      ready: false,
      activePid: Option.none(),
      restartAttempt: 0,
      restartScheduled: false,
      shuttingDown: false,
    }),
  });

  const environmentLayer = Layer.effect(
    DesktopEnvironment,
    makeDesktopEnvironment({
      dirname: "/repo/apps/desktop/src",
      env: { T3CODE_HOME: `/tmp/t3-desktop-updates-test-${process.pid}` },
      cwd: "/repo",
      platform: "darwin",
      processArch: "x64",
      appVersion: "1.2.3",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }),
  ).pipe(Layer.provide(EffectPath.layer));

  const layer = DesktopUpdates.layer.pipe(
    Layer.provideMerge(updaterLayer),
    Layer.provideMerge(windowLayer),
    Layer.provideMerge(backendLayer),
    Layer.provideMerge(DesktopState.layer),
    Layer.provideMerge(DesktopSettingsState.layer),
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  return {
    layer,
    checkCount: () => checkCount,
    feedUrls: () => feedUrls,
    listenerCount: () =>
      Array.from(listeners.values()).reduce(
        (total, eventListeners) => total + eventListeners.size,
        0,
      ),
    sentStates,
    emit: (eventName, payload) => {
      for (const listener of listeners.get(eventName) ?? []) {
        listener(payload);
      }
    },
  };
}

describe("DesktopUpdates", () => {
  beforeEach(() => {
    process.env.T3CODE_DESKTOP_MOCK_UPDATES = "1";
    process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT = "4141";
  });

  afterEach(() => {
    if (originalMockUpdates === undefined) {
      delete process.env.T3CODE_DESKTOP_MOCK_UPDATES;
    } else {
      process.env.T3CODE_DESKTOP_MOCK_UPDATES = originalMockUpdates;
    }

    if (originalMockUpdatePort === undefined) {
      delete process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT;
    } else {
      process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT = originalMockUpdatePort;
    }
  });

  it.effect("configures the updater and runs startup checks on the test clock", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;

          const state = yield* updates.getState;
          assert.equal(state.enabled, true);
          assert.equal(state.status, "idle");
          assert.deepEqual(harness.feedUrls(), [
            { provider: "generic", url: "http://localhost:4141" },
          ]);
          assert.equal(harness.listenerCount(), 6);
          assert.equal(harness.checkCount(), 0);

          yield* TestClock.adjust(Duration.millis(15_000));
          assert.equal(harness.checkCount(), 1);
        }),
      );

      assert.equal(harness.listenerCount(), 0);
    }).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("updates and broadcasts state from updater events", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;

          harness.emit("update-available", { version: "1.2.4" });
          yield* flushCallbacks;

          const state = yield* updates.getState;
          assert.equal(state.status, "available");
          assert.equal(state.availableVersion, "1.2.4");
          assert.isNotNull(state.checkedAt);
          assert.equal(harness.sentStates.at(-1)?.status, "available");
        }),
      );
    }).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("persists channel changes through the settings service", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const settingsState = yield* DesktopSettingsState.DesktopSettingsState;
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* settingsState.set(DEFAULT_DESKTOP_SETTINGS);
          yield* updates.configure;

          const state = yield* updates.setChannel("nightly");
          const settings = yield* settingsState.get;

          assert.equal(state.channel, "nightly");
          assert.equal(settings.updateChannel, "nightly");
          assert.equal(settings.updateChannelConfiguredByUser, true);
        }),
      );
    }).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });
});
