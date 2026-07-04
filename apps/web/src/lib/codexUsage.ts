import type { CodexUsageSnapshot, CodexUsageWindow } from "@t3tools/contracts";

export function remainingCodexPercent(window: CodexUsageWindow | undefined): number | undefined {
  if (!window) return undefined;
  return Math.max(0, Math.min(100, 100 - window.usedPercent));
}

export function codexUsageWindowLabel(
  window: CodexUsageWindow | undefined,
  fallback: string,
): string {
  const duration = window?.windowDurationMins;
  if (!duration) return fallback;
  if (duration % 1440 === 0) return `${duration / 1440}d`;
  if (duration % 60 === 0) return `${duration / 60}h`;
  return `${duration}m`;
}

export function compactCodexUsage(usage: CodexUsageSnapshot | undefined): string {
  if (!usage) return "Usage unavailable";
  const primary = remainingCodexPercent(usage.primary);
  const secondary = remainingCodexPercent(usage.secondary);
  const parts = [
    primary === undefined ? undefined : `${primary}% 5h`,
    secondary === undefined ? undefined : `${secondary}% weekly`,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : "No rate-limit data";
}

export function formatCodexUsageReset(window: CodexUsageWindow | undefined): string | undefined {
  if (!window?.resetsAt) return undefined;
  return new Date(window.resetsAt * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
