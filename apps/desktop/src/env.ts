import type { DesktopPlatform, DesktopWindowControlsLayout } from "@t3tools/contracts";
import type { LinuxTitleBarMode } from "@t3tools/contracts/settings";
import { getLinuxWindowControlsLayout } from "./linuxWindowControls";

const DESKTOP_TITLEBAR_HEIGHT = 52;
const RTL_LANGUAGES = new Set(["ar", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"]);
const MACOS_WINDOW_CONTROLS_LAYOUT: DesktopWindowControlsLayout = {
  left: ["close", "minimize", "maximize"],
  right: [],
};
const WINDOWS_WINDOW_CONTROLS_LAYOUT: DesktopWindowControlsLayout = {
  left: [],
  right: ["minimize", "maximize", "close"],
};

export const platform: DesktopPlatform = (() => {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported desktop platform: ${process.platform}`);
  }
})();

function isRightToLeftLocale(locale: string | undefined): boolean {
  if (!locale) {
    return false;
  }

  const language = locale.split(/[-_]/, 1)[0]?.toLowerCase();
  return language !== undefined && RTL_LANGUAGES.has(language);
}

function mirrorWindowControlsLayout(
  layout: DesktopWindowControlsLayout,
): DesktopWindowControlsLayout {
  return {
    left: layout.right.toReversed(),
    right: layout.left.toReversed(),
  };
}

export function getWindowControlsLayout(options?: {
  locale?: string;
  platform?: DesktopPlatform;
}): DesktopWindowControlsLayout {
  const resolvedPlatform = options?.platform ?? platform;
  if (resolvedPlatform === "linux") {
    return getLinuxWindowControlsLayout();
  }

  const rtl = isRightToLeftLocale(options?.locale);
  const layout =
    resolvedPlatform === "macos" ? MACOS_WINDOW_CONTROLS_LAYOUT : WINDOWS_WINDOW_CONTROLS_LAYOUT;

  if (!rtl || resolvedPlatform === "macos") {
    return layout;
  }

  return mirrorWindowControlsLayout(layout);
}

export function getWindowChromeOptions(linuxTitleBarMode: LinuxTitleBarMode): {
  titleBarStyle?: "hiddenInset" | "hidden";
  titleBarOverlay?: { height: number };
  trafficLightPosition?: { x: number; y: number };
} {
  if (platform === "macos") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }

  if (platform === "linux") {
    if (linuxTitleBarMode === "native") {
      return {};
    }

    if (linuxTitleBarMode === "overlay") {
      return {
        titleBarStyle: "hidden",
        titleBarOverlay: {
          height: DESKTOP_TITLEBAR_HEIGHT,
        },
      };
    }

    return {
      titleBarStyle: "hidden",
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      height: DESKTOP_TITLEBAR_HEIGHT,
    },
  };
}
