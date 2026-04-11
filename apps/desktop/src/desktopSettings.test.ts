import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  readDesktopSettings,
  setDesktopLinuxTitleBarMode,
  setDesktopServerExposurePreference,
  writeDesktopSettings,
} from "./desktopSettings";

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
    expect(readDesktopSettings(makeSettingsPath())).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("persists and reloads the configured server exposure mode", () => {
    const settingsPath = makeSettingsPath();

    writeDesktopSettings(settingsPath, {
      serverExposureMode: "network-accessible",
      linuxTitleBarMode: "custom",
    });

    expect(readDesktopSettings(settingsPath)).toEqual({
      serverExposureMode: "network-accessible",
      linuxTitleBarMode: "custom",
    });
  });

  it("preserves the requested network-accessible preference across temporary fallback", () => {
    expect(
      setDesktopServerExposurePreference(
        {
          serverExposureMode: "local-only",
          linuxTitleBarMode: DEFAULT_DESKTOP_SETTINGS.linuxTitleBarMode,
        },
        "network-accessible",
      ),
    ).toEqual({
      serverExposureMode: "network-accessible",
      linuxTitleBarMode: DEFAULT_DESKTOP_SETTINGS.linuxTitleBarMode,
    });
  });

  it("falls back to defaults when the settings file is malformed", () => {
    const settingsPath = makeSettingsPath();
    fs.writeFileSync(settingsPath, "{not-json", "utf8");

    expect(readDesktopSettings(settingsPath)).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it("updates the requested linux title bar mode", () => {
    expect(
      setDesktopLinuxTitleBarMode(
        {
          ...DEFAULT_DESKTOP_SETTINGS,
          linuxTitleBarMode: "native",
        },
        "overlay",
      ),
    ).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      linuxTitleBarMode: "overlay",
    });
  });
});
