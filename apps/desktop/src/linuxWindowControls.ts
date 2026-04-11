import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import type { DesktopWindowControl, DesktopWindowControlsLayout } from "@t3tools/contracts";

interface LinuxWindowControlsDependencies {
  existsSync?: typeof FS.existsSync;
  homeDir?: string;
  readFileSync?: typeof FS.readFileSync;
  spawnSync?: typeof ChildProcess.spawnSync;
}

const FALLBACK_WINDOW_CONTROLS_LAYOUT: DesktopWindowControlsLayout = {
  left: [],
  right: ["minimize", "maximize", "close"],
};

function mapKdeButtonCode(code: string): DesktopWindowControl | null {
  switch (code) {
    case "I":
      return "minimize";
    case "A":
      return "maximize";
    case "X":
      return "close";
    default:
      return null;
  }
}

function parseKdeButtonBank(value: string | undefined): readonly DesktopWindowControl[] {
  if (!value) {
    return [];
  }

  return [...value].flatMap((code) => {
    const mapped = mapKdeButtonCode(code);
    return mapped ? [mapped] : [];
  });
}

function readKdeWindowControlsLayout(
  dependencies: Required<LinuxWindowControlsDependencies>,
): DesktopWindowControlsLayout | null {
  const kwinConfigPath = Path.join(dependencies.homeDir, ".config/kwinrc");
  if (!dependencies.existsSync(kwinConfigPath)) {
    return null;
  }

  const content = dependencies.readFileSync(kwinConfigPath, "utf8");
  const left = content.match(/^ButtonsOnLeft=(.*)$/m)?.[1]?.trim();
  const right = content.match(/^ButtonsOnRight=(.*)$/m)?.[1]?.trim();
  const parsedLeft = parseKdeButtonBank(left);
  const parsedRight = parseKdeButtonBank(right);

  if (parsedLeft.length === 0 && parsedRight.length === 0) {
    return null;
  }

  return {
    left: parsedLeft,
    right: parsedRight,
  };
}

function mapGnomeButtonName(name: string): DesktopWindowControl | null {
  switch (name) {
    case "minimize":
      return "minimize";
    case "maximize":
      return "maximize";
    case "close":
      return "close";
    default:
      return null;
  }
}

function parseGnomeButtonBank(value: string): readonly DesktopWindowControl[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .flatMap((name) => {
      const mapped = mapGnomeButtonName(name);
      return mapped ? [mapped] : [];
    });
}

function readGnomeWindowControlsLayout(
  dependencies: Required<LinuxWindowControlsDependencies>,
): DesktopWindowControlsLayout | null {
  const result = dependencies.spawnSync(
    "gsettings",
    ["get", "org.gnome.desktop.wm.preferences", "button-layout"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim().replace(/^'+|'+$/g, "");
  if (!value) {
    return null;
  }

  const [left = "", right = ""] = value.split(":");
  return {
    left: parseGnomeButtonBank(left),
    right: parseGnomeButtonBank(right),
  };
}

function safelyReadWindowControlsLayout(
  source: string,
  readLayout: () => DesktopWindowControlsLayout | null,
): DesktopWindowControlsLayout | null {
  try {
    return readLayout();
  } catch (error) {
    console.warn(`[desktop] failed to read linux window controls from ${source}`, error);
    return null;
  }
}

export function getLinuxWindowControlsLayout(
  dependencies: LinuxWindowControlsDependencies = {},
): DesktopWindowControlsLayout {
  const resolvedDependencies: Required<LinuxWindowControlsDependencies> = {
    existsSync: dependencies.existsSync ?? FS.existsSync,
    homeDir: dependencies.homeDir ?? OS.homedir(),
    readFileSync: dependencies.readFileSync ?? FS.readFileSync,
    spawnSync: dependencies.spawnSync ?? ChildProcess.spawnSync,
  };

  return (
    safelyReadWindowControlsLayout("kde", () =>
      readKdeWindowControlsLayout(resolvedDependencies),
    ) ??
    safelyReadWindowControlsLayout("gnome", () =>
      readGnomeWindowControlsLayout(resolvedDependencies),
    ) ??
    FALLBACK_WINDOW_CONTROLS_LAYOUT
  );
}
