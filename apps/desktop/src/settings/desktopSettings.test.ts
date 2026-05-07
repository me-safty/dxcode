import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettingsEffect,
  resolveDefaultDesktopSettings,
  setDesktopServerExposurePreference,
  setDesktopTailscaleServePreference,
  setDesktopUpdateChannelPreference,
  writeDesktopSettingsEffect,
} from "./desktopSettings.ts";

const DesktopSettingsPatch = Schema.Struct({
  serverExposureMode: Schema.optional(Schema.Literals(["local-only", "network-accessible"])),
  tailscaleServeEnabled: Schema.optional(Schema.Boolean),
  tailscaleServePort: Schema.optional(Schema.Number),
  updateChannel: Schema.optional(Schema.Literals(["latest", "nightly"])),
  updateChannelConfiguredByUser: Schema.optional(Schema.Boolean),
});

const encodeDesktopSettingsPatch = Schema.encodeEffect(Schema.fromJsonString(DesktopSettingsPatch));

function makeSettingsPath() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-desktop-settings-test-",
    });
    return path.join(directory, "desktop-settings.json");
  });
}

function writeSettingsPatch(filePath: string, patch: typeof DesktopSettingsPatch.Type) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const encoded = yield* encodeDesktopSettingsPatch(patch);
    yield* fs.writeFileString(filePath, `${encoded}\n`);
  });
}

describe("desktopSettings", () => {
  it.effect("returns defaults when no settings file exists", () =>
    Effect.gen(function* () {
      const settingsPath = yield* makeSettingsPath();
      const settings = yield* readDesktopSettingsEffect(settingsPath, "0.0.17");
      assert.deepEqual(settings, DEFAULT_DESKTOP_SETTINGS);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("defaults packaged nightly builds to the nightly update channel", () => {
    assert.deepEqual(resolveDefaultDesktopSettings("0.0.17-nightly.20260415.1"), {
      serverExposureMode: "local-only",
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
    });
  });

  it.effect("persists and reloads the configured server exposure mode", () =>
    Effect.gen(function* () {
      const settingsPath = yield* makeSettingsPath();

      yield* writeDesktopSettingsEffect(settingsPath, {
        serverExposureMode: "network-accessible",
        tailscaleServeEnabled: true,
        tailscaleServePort: 8443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
      });

      const settings = yield* readDesktopSettingsEffect(settingsPath, "0.0.17");
      assert.deepEqual(settings, {
        serverExposureMode: "network-accessible",
        tailscaleServeEnabled: true,
        tailscaleServePort: 8443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("preserves the requested network-accessible preference across temporary fallback", () => {
    assert.deepEqual(
      setDesktopServerExposurePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        },
        "network-accessible",
      ),
      {
        serverExposureMode: "network-accessible",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: false,
      },
    );
  });

  it("persists the requested Tailscale Serve preference", () => {
    assert.deepEqual(
      setDesktopTailscaleServePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        },
        { enabled: true, port: 8443 },
      ),
      {
        serverExposureMode: "local-only",
        tailscaleServeEnabled: true,
        tailscaleServePort: 8443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: false,
      },
    );
  });

  it("preserves the configured Tailscale Serve port when no new port is requested", () => {
    assert.deepEqual(
      setDesktopTailscaleServePreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 8443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        },
        { enabled: true },
      ),
      {
        serverExposureMode: "local-only",
        tailscaleServeEnabled: true,
        tailscaleServePort: 8443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: false,
      },
    );
  });

  it("persists the requested nightly update channel", () => {
    assert.deepEqual(
      setDesktopUpdateChannelPreference(
        {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        },
        "nightly",
      ),
      {
        serverExposureMode: "local-only",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
        updateChannel: "nightly",
        updateChannelConfiguredByUser: true,
      },
    );
  });

  it.effect("falls back to defaults when the settings file is malformed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const settingsPath = yield* makeSettingsPath();
      yield* fs.writeFileString(settingsPath, "{not-json");

      const settings = yield* readDesktopSettingsEffect(settingsPath, "0.0.17");
      assert.deepEqual(settings, DEFAULT_DESKTOP_SETTINGS);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "falls back to the nightly channel for legacy nightly settings without an update track",
    () =>
      Effect.gen(function* () {
        const settingsPath = yield* makeSettingsPath();
        yield* writeSettingsPatch(settingsPath, { serverExposureMode: "local-only" });

        const settings = yield* readDesktopSettingsEffect(
          settingsPath,
          "0.0.17-nightly.20260415.1",
        );
        assert.deepEqual(settings, {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "nightly",
          updateChannelConfiguredByUser: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "migrates legacy implicit stable settings to nightly when running a nightly build",
    () =>
      Effect.gen(function* () {
        const settingsPath = yield* makeSettingsPath();
        yield* writeSettingsPatch(settingsPath, {
          serverExposureMode: "local-only",
          updateChannel: "latest",
        });

        const settings = yield* readDesktopSettingsEffect(
          settingsPath,
          "0.0.17-nightly.20260415.1",
        );
        assert.deepEqual(settings, {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          updateChannel: "nightly",
          updateChannelConfiguredByUser: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("preserves an explicit stable choice on nightly builds", () =>
    Effect.gen(function* () {
      const settingsPath = yield* makeSettingsPath();
      yield* writeSettingsPatch(settingsPath, {
        serverExposureMode: "local-only",
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
      });

      const settings = yield* readDesktopSettingsEffect(settingsPath, "0.0.17-nightly.20260415.1");
      assert.deepEqual(settings, {
        serverExposureMode: "local-only",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "falls back to the default Tailscale Serve port when the persisted port is invalid",
    () =>
      Effect.gen(function* () {
        const settingsPath = yield* makeSettingsPath();
        yield* writeSettingsPatch(settingsPath, {
          tailscaleServeEnabled: true,
          tailscaleServePort: 0,
        });

        const settings = yield* readDesktopSettingsEffect(settingsPath, "0.0.17");
        assert.deepEqual(settings, {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: true,
          tailscaleServePort: 443,
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
