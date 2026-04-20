import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

const PREFERRED_WINDOW_ORDER = ["5h", "7d"] as const;

function normalizeWindowOrderKey(window: ServerProviderUsageWindow): string {
  return window.id.trim().toLowerCase();
}

export function orderProviderUsageWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return windows
    .map((window, index) => ({ window, index }))
    .toSorted((left, right) => {
      const leftRank = PREFERRED_WINDOW_ORDER.indexOf(
        normalizeWindowOrderKey(left.window) as (typeof PREFERRED_WINDOW_ORDER)[number],
      );
      const rightRank = PREFERRED_WINDOW_ORDER.indexOf(
        normalizeWindowOrderKey(right.window) as (typeof PREFERRED_WINDOW_ORDER)[number],
      );

      if (leftRank !== rightRank) {
        const resolvedLeftRank = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
        const resolvedRightRank = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
        return resolvedLeftRank - resolvedRightRank;
      }

      return left.index - right.index;
    })
    .map(({ window }) => window);
}

export function primaryProviderUsageWindow(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ServerProviderUsageWindow | undefined {
  return orderProviderUsageWindows(windows)[0];
}

export function shortProviderPlanLabel(
  authLabel: ServerProvider["auth"]["label"] | null | undefined,
): string | null {
  if (!authLabel) {
    return null;
  }

  const normalized = authLabel.trim().toLowerCase();
  if (normalized.includes("api key")) {
    return null;
  }
  if (normalized.includes(" max ")) {
    return "Max";
  }
  if (normalized.includes(" pro ")) {
    return "Pro";
  }
  if (normalized.includes(" plus ")) {
    return "Plus";
  }
  if (normalized.includes(" team ")) {
    return "Team";
  }
  if (normalized.includes(" business ")) {
    return "Business";
  }
  if (normalized.includes(" enterprise ")) {
    return "Enterprise";
  }
  if (normalized.includes(" edu ")) {
    return "Edu";
  }
  if (normalized.includes(" free ")) {
    return "Free";
  }
  if (normalized.includes(" go ")) {
    return "Go";
  }

  return null;
}

export function formatProviderUsagePercent(percentUsed: number | null): string {
  if (percentUsed === null || !Number.isFinite(percentUsed)) {
    return "--";
  }

  return percentUsed < 10
    ? `${Number(percentUsed.toFixed(1)).toString()}%`
    : `${Math.round(percentUsed)}%`;
}

export function formatProviderUsageResetAt(
  resetsAt: string | null,
  now: number | Date = Date.now(),
): string | null {
  if (!resetsAt) {
    return null;
  }

  const targetTime = Date.parse(resetsAt);
  if (Number.isNaN(targetTime)) {
    return null;
  }

  const currentTime = now instanceof Date ? now.getTime() : now;
  const totalMinutes = Math.ceil((targetTime - currentTime) / 60_000);
  if (totalMinutes <= 0) {
    return null;
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
