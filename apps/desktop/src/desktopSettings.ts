import * as FS from "node:fs";
import * as Path from "node:path";
import type { DesktopServerExposureMode } from "@t3tools/contracts";
import { DEFAULT_LINUX_TITLE_BAR_MODE, type LinuxTitleBarMode } from "@t3tools/contracts/settings";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly linuxTitleBarMode: LinuxTitleBarMode;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  linuxTitleBarMode: DEFAULT_LINUX_TITLE_BAR_MODE,
};

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

export function setDesktopLinuxTitleBarMode(
  settings: DesktopSettings,
  requestedMode: LinuxTitleBarMode,
): DesktopSettings {
  return settings.linuxTitleBarMode === requestedMode
    ? settings
    : {
        ...settings,
        linuxTitleBarMode: requestedMode,
      };
}

export function readDesktopSettings(settingsPath: string): DesktopSettings {
  try {
    if (!FS.existsSync(settingsPath)) {
      return DEFAULT_DESKTOP_SETTINGS;
    }

    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      readonly serverExposureMode?: unknown;
      readonly linuxTitleBarMode?: unknown;
    };

    return {
      serverExposureMode:
        parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
      linuxTitleBarMode:
        parsed.linuxTitleBarMode === "overlay" || parsed.linuxTitleBarMode === "custom"
          ? parsed.linuxTitleBarMode
          : DEFAULT_LINUX_TITLE_BAR_MODE,
    };
  } catch {
    return DEFAULT_DESKTOP_SETTINGS;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
