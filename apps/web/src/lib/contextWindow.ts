import type { OrchestrationThreadActivity, ThreadTokenUsageSnapshot } from "@pathwayos/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export interface CodexRateLimitWindowSnapshot {
  readonly label: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt: number | null;
  readonly resetLabel: string | null;
}

export interface CodexRateLimitSnapshot {
  readonly planType: string | null;
  readonly primary: CodexRateLimitWindowSnapshot | null;
  readonly secondary: CodexRateLimitWindowSnapshot | null;
  readonly individualLimit: {
    readonly used: string;
    readonly limit: string;
    readonly remainingPercent: number;
    readonly resetsAt: number;
    readonly resetLabel: string | null;
  } | null;
  readonly updatedAt: string;
}

/** Map a provider driver kind to a user-facing display name. */
export function formatProviderDisplayName(provider: string | null | undefined): string {
  if (!provider) return "This agent";
  switch (provider) {
    case "claudeAgent":
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default: {
      // Title-case unknown driver kinds so they read reasonably.
      const trimmed = provider.replace(/Agent$/i, "").trim();
      if (trimmed.length === 0) return provider;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
}

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatRateLimitWindowLabel(minutes: number | null, fallback: string): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return fallback;
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`;
  }
  if (minutes === 60 * 24 * 7) {
    return "Weekly";
  }
  return `${Math.round(minutes / (60 * 24))}d`;
}

function formatRateLimitReset(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const millis = value < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function deriveRateLimitWindow(
  value: unknown,
  fallbackLabel: string,
): CodexRateLimitWindowSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const usedPercent = asFiniteNumber(record.usedPercent);
  if (usedPercent === null) {
    return null;
  }
  const boundedUsedPercent = Math.max(0, Math.min(100, usedPercent));
  const resetsAt = asFiniteNumber(record.resetsAt);
  return {
    label: formatRateLimitWindowLabel(asFiniteNumber(record.windowDurationMins), fallbackLabel),
    usedPercent: boundedUsedPercent,
    remainingPercent: Math.max(0, 100 - boundedUsedPercent),
    resetsAt,
    resetLabel: formatRateLimitReset(resetsAt),
  };
}

function deriveIndividualLimit(value: unknown): CodexRateLimitSnapshot["individualLimit"] {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const used = asString(record.used);
  const limit = asString(record.limit);
  const remainingPercent = asFiniteNumber(record.remainingPercent);
  const resetsAt = asFiniteNumber(record.resetsAt);
  if (!used || !limit || remainingPercent === null || resetsAt === null) {
    return null;
  }
  return {
    used,
    limit,
    remainingPercent: Math.max(0, Math.min(100, remainingPercent)),
    resetsAt,
    resetLabel: formatRateLimitReset(resetsAt),
  };
}

export function deriveCodexRateLimitSnapshotFromPayload(
  payloadValue: unknown,
  updatedAt: string,
): CodexRateLimitSnapshot | null {
  const rawPayload = asRecord(payloadValue);
  const payload = asRecord(rawPayload?.rateLimits) ?? rawPayload;
  if (!payload) {
    return null;
  }

  const primary = deriveRateLimitWindow(payload.primary, "Primary");
  const secondary = deriveRateLimitWindow(payload.secondary, "Secondary");
  const individualLimit = deriveIndividualLimit(payload.individualLimit);
  if (!primary && !secondary && !individualLimit) {
    return null;
  }

  return {
    planType: asString(payload.planType),
    primary,
    secondary,
    individualLimit,
    updatedAt,
  };
}

export function deriveLatestCodexRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): CodexRateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account-rate-limits.updated") {
      continue;
    }

    const snapshot = deriveCodexRateLimitSnapshotFromPayload(activity.payload, activity.createdAt);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
