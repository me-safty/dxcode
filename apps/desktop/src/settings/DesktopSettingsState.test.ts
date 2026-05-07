import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DEFAULT_DESKTOP_SETTINGS } from "./desktopSettings.ts";
import * as DesktopSettingsState from "./DesktopSettingsState.ts";

describe("DesktopSettingsState", () => {
  it.effect("updates settings through effectful ref operations", () =>
    Effect.gen(function* () {
      const settingsState = yield* DesktopSettingsState.DesktopSettingsState;

      assert.deepEqual(yield* settingsState.get, DEFAULT_DESKTOP_SETTINGS);

      const settings = {
        ...DEFAULT_DESKTOP_SETTINGS,
        updateChannel: "nightly" as const,
        updateChannelConfiguredByUser: true,
      };
      yield* settingsState.set(settings);

      assert.deepEqual(yield* settingsState.get, settings);

      const updated = yield* settingsState.update((current) => ({
        ...current,
        updateChannel: "latest",
      }));

      assert.equal(updated.updateChannel, "latest");
      assert.deepEqual(yield* settingsState.get, updated);
    }).pipe(Effect.provide(DesktopSettingsState.layer)),
  );
});
