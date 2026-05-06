import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vitest";

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    disableDifferentialDownload: false,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe("ElectronUpdater", () => {
  beforeEach(() => {
    autoUpdaterMock.allowDowngrade = false;
    autoUpdaterMock.allowPrerelease = false;
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = true;
    autoUpdaterMock.channel = "latest";
    autoUpdaterMock.disableDifferentialDownload = false;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.on.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();
    autoUpdaterMock.removeListener.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
  });

  it.effect("wraps updater configuration and actions", () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;

      yield* updater.setFeedURL({ provider: "generic", url: "http://127.0.0.1:3000" });
      yield* updater.setAutoDownload(false);
      yield* updater.setAutoInstallOnAppQuit(false);
      yield* updater.setChannel("nightly");
      yield* updater.setAllowPrerelease(true);
      yield* updater.setAllowDowngrade(true);
      yield* updater.setDisableDifferentialDownload(true);
      yield* updater.checkForUpdates;
      yield* updater.downloadUpdate;
      yield* updater.quitAndInstall({ isSilent: true, isForceRunAfter: true });

      assert.deepEqual(autoUpdaterMock.setFeedURL.mock.calls, [
        [{ provider: "generic", url: "http://127.0.0.1:3000" }],
      ]);
      assert.equal(autoUpdaterMock.autoDownload, false);
      assert.equal(autoUpdaterMock.autoInstallOnAppQuit, false);
      assert.equal(autoUpdaterMock.channel, "nightly");
      assert.equal(autoUpdaterMock.allowPrerelease, true);
      assert.equal(autoUpdaterMock.allowDowngrade, true);
      assert.equal(autoUpdaterMock.disableDifferentialDownload, true);
      assert.equal(autoUpdaterMock.checkForUpdates.mock.calls.length, 1);
      assert.equal(autoUpdaterMock.downloadUpdate.mock.calls.length, 1);
      assert.deepEqual(autoUpdaterMock.quitAndInstall.mock.calls, [[true, true]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("scopes updater event listeners", () =>
    Effect.gen(function* () {
      const listener = vi.fn();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const updater = yield* ElectronUpdater.ElectronUpdater;
          yield* updater.on("update-available", listener);
        }),
      );

      assert.deepEqual(autoUpdaterMock.on.mock.calls, [["update-available", listener]]);
      assert.deepEqual(autoUpdaterMock.removeListener.mock.calls, [["update-available", listener]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
});
