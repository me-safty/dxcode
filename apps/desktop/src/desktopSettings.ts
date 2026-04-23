import * as FS from "node:fs";
import * as Path from "node:path";
import type {
  DesktopServerExposureMode,
  DesktopTitleBarMode,
  DesktopUpdateChannel,
} from "@t3tools/contracts";

import { resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly updateChannel: DesktopUpdateChannel;
  readonly updateChannelConfiguredByUser: boolean;
  readonly titleBarMode: DesktopTitleBarMode;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  updateChannel: "latest",
  updateChannelConfiguredByUser: false,
  titleBarMode: "custom",
};

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function setDesktopUpdateChannelPreference(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return {
    ...settings,
    updateChannel: requestedChannel,
    updateChannelConfiguredByUser: true,
  };
}

export function setDesktopTitleBarModePreference(
  settings: DesktopSettings,
  requestedMode: DesktopTitleBarMode,
): DesktopSettings {
  return settings.titleBarMode === requestedMode
    ? settings
    : {
        ...settings,
        titleBarMode: requestedMode,
      };
}

export function readDesktopSettings(settingsPath: string, appVersion: string): DesktopSettings {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  try {
    if (!FS.existsSync(settingsPath)) {
      return defaultSettings;
    }

    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      readonly serverExposureMode?: unknown;
      readonly updateChannel?: unknown;
      readonly updateChannelConfiguredByUser?: unknown;
      readonly titleBarMode?: unknown;
    };
    const parsedUpdateChannel =
      parsed.updateChannel === "nightly" || parsed.updateChannel === "latest"
        ? parsed.updateChannel
        : null;
    const isLegacySettings = parsed.updateChannelConfiguredByUser === undefined;
    const updateChannelConfiguredByUser =
      parsed.updateChannelConfiguredByUser === true ||
      (isLegacySettings && parsedUpdateChannel === "nightly");

    return {
      serverExposureMode:
        parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
      updateChannel:
        updateChannelConfiguredByUser && parsedUpdateChannel !== null
          ? parsedUpdateChannel
          : defaultSettings.updateChannel,
      updateChannelConfiguredByUser,
      titleBarMode: parsed.titleBarMode === "native" ? "native" : "custom",
    };
  } catch {
    return defaultSettings;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
