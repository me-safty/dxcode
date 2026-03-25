import type {
  DesktopUpdateActionResult,
  DesktopUpdateState,
  DesktopUpdateStatus,
} from "@t3tools/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

export interface DesktopUpdateButtonVisualState {
  pulse: boolean;
  colorClass: string;
  hoverClass: string;
}

/** Fallback visual used for statuses without an explicit mapping (e.g. idle, checking). */
export const DEFAULT_VISUAL: DesktopUpdateButtonVisualState = {
  pulse: true,
  colorClass: "text-amber-500",
  hoverClass: "hover:text-amber-400 hover:bg-amber-500/10",
};

const VISUAL_BY_STATUS: Partial<Record<DesktopUpdateStatus, DesktopUpdateButtonVisualState>> = {
  available: DEFAULT_VISUAL,
  downloading: {
    pulse: false,
    colorClass: "text-sky-400",
    hoverClass: "hover:text-sky-300 hover:bg-sky-400/10",
  },
  downloaded: {
    pulse: true,
    colorClass: "text-emerald-500",
    hoverClass: "hover:text-emerald-400 hover:bg-emerald-500/10",
  },
  error: {
    pulse: true,
    colorClass: "text-rose-500",
    hoverClass: "hover:text-rose-400 hover:bg-rose-500/10",
  },
};

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "available") return "download";
  if (state.status === "downloaded") return "install";
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) return "install";
    if (state.errorContext === "download" && state.availableVersion) return "download";
  }
  return "none";
}

export function resolveDesktopUpdateButtonVisualState(
  state: DesktopUpdateState,
): DesktopUpdateButtonVisualState {
  return VISUAL_BY_STATUS[state.status] ?? DEFAULT_VISUAL;
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.";
  }
  if (action === "install") {
    return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but T3 Code is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return state.message ?? "Update failed";
  }
  return "Update available";
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}
