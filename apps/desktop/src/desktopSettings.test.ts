import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettings,
  resolveDefaultDesktopSettings,
  setDesktopServerExposurePreference,
  setDesktopTitleBarModePreference,
  setDesktopUpdateChannelPreference,
  writeDesktopSettings,
} from "./desktopSettings.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeSettingsPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-desktop-settings-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "desktop-settings.json");
}

describe("desktopSettings", () => {
  it("returns defaults when no settings file exists", () => {
    expect(readDesktopSettings(makeSettingsPath(), "0.0.17")).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("defaults packaged nightly builds to the nightly update channel", () => {
    expect(resolveDefaultDesktopSettings("0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      titleBarMode: "custom",
    });
  });

  it("persists and reloads the configured server exposure mode", () => {
    const settingsPath = makeSettingsPath();

    writeDesktopSettings(settingsPath, {
      serverExposureMode: "network-accessible",
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      titleBarMode: "native",
    });

    expect(readDesktopSettings(settingsPath, "0.0.17")).toEqual({
      serverExposureMode: "network-accessible",
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      titleBarMode: "native",
    });
  });

  it("preserves the requested network-accessible preference across temporary fallback", () => {
    expect(
      setDesktopServerExposurePreference(
        {
          serverExposureMode: "local-only",
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          titleBarMode: "custom",
        },
        "network-accessible",
      ),
    ).toEqual({
      serverExposureMode: "network-accessible",
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      titleBarMode: "custom",
    });
  });

  it("persists the requested nightly update channel", () => {
    expect(
      setDesktopUpdateChannelPreference(
        {
          serverExposureMode: "local-only",
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          titleBarMode: "custom",
        },
        "nightly",
      ),
    ).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "nightly",
      updateChannelConfiguredByUser: true,
      titleBarMode: "custom",
    });
  });

  it("persists the requested titlebar mode", () => {
    expect(
      setDesktopTitleBarModePreference(
        {
          serverExposureMode: "local-only",
          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
          titleBarMode: "custom",
        },
        "native",
      ),
    ).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "latest",
      updateChannelConfiguredByUser: false,
      titleBarMode: "native",
    });
  });

  it("falls back to defaults when the settings file is malformed", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(settingsPath, "{not-json", "utf8");

    expect(readDesktopSettings(settingsPath, "0.0.17")).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("falls back to the nightly channel for legacy nightly settings without an update track", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ serverExposureMode: "local-only" }), "utf8");

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      titleBarMode: "custom",
    });
  });

  it("migrates legacy implicit stable settings to nightly when running a nightly build", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        serverExposureMode: "local-only",
        updateChannel: "latest",
      }),
      "utf8",
    );

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "nightly",
      updateChannelConfiguredByUser: false,
      titleBarMode: "custom",
    });
  });

  it("preserves an explicit stable choice on nightly builds", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        serverExposureMode: "local-only",
        updateChannel: "latest",
        updateChannelConfiguredByUser: true,
      }),
      "utf8",
    );

    expect(readDesktopSettings(settingsPath, "0.0.17-nightly.20260415.1")).toEqual({
      serverExposureMode: "local-only",
      updateChannel: "latest",
      updateChannelConfiguredByUser: true,
      titleBarMode: "custom",
    });
  });
});
