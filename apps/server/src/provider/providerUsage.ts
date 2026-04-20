import type {
  ProviderRuntimeEvent,
  ServerProvider,
  ServerProviderUsage,
  ServerProviderUsageLevel,
} from "@t3tools/contracts";

import { codexAccountAuthMetadata } from "./codexAccount.ts";

type WindowCandidate = {
  readonly hint?: string | undefined;
  readonly value: unknown;
};

const WINDOW_CONTAINER_KEYS = new Set(["windows", "limits", "rateLimits", "rate_limits"]);
const PERCENT_KEYS = new Set([
  "percentused",
  "usedpercent",
  "percentage",
  "pct",
  "usagepercent",
  "usedpct",
]);
const RATIO_KEYS = new Set(["utilization", "ratio", "usageratio"]);
const WINDOW_DURATION_KEYS = new Set([
  "windowdurationmins",
  "windowdurationminutes",
  "durationmins",
  "durationminutes",
]);
const RESET_KEYS = new Set(["resetsat", "resetat", "retryat", "overageresetsat"]);
const STATUS_KEYS = new Set(["state", "status", "message", "detail", "error", "reason"]);
const MESSAGE_KEYS = new Set(["message", "detail", "error", "reason"]);
const EXHAUSTED_KEYS = new Set(["exhausted", "isexhausted"]);

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

const UNIT_SUFFIXES: Record<string, string> = {
  minute: "m",
  minutes: "m",
  min: "m",
  mins: "m",
  m: "m",
  hour: "h",
  hours: "h",
  hr: "h",
  hrs: "h",
  h: "h",
  day: "d",
  days: "d",
  d: "d",
  week: "w",
  weeks: "w",
  w: "w",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstMatchingValue(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): unknown | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(normalizeLookupKey(key))) {
      return value;
    }
  }

  return undefined;
}

function firstMatchingString(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): string | undefined {
  return trimString(firstMatchingValue(record, keys));
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstMatchingNumber(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): number | undefined {
  return toFiniteNumber(firstMatchingValue(record, keys));
}

function firstMatchingBoolean(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean | undefined {
  const value = firstMatchingValue(record, keys);
  return typeof value === "boolean" ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatWindowDurationLabel(windowDurationMins: number | undefined): string | undefined {
  if (windowDurationMins === undefined || !Number.isFinite(windowDurationMins)) {
    return undefined;
  }

  const roundedMinutes = Math.round(windowDurationMins);
  if (roundedMinutes <= 0) {
    return undefined;
  }
  if (roundedMinutes % (24 * 60) === 0) {
    return `${roundedMinutes / (24 * 60)}d`;
  }
  if (roundedMinutes % 60 === 0) {
    return `${roundedMinutes / 60}h`;
  }
  return `${roundedMinutes}m`;
}

function titleCaseWord(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return value[0]!.toUpperCase() + value.slice(1).toLowerCase();
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(titleCaseWord)
    .join(" ");
}

function normalizeWindowLabel(
  rawLabel: string | undefined,
  windowDurationMins: number | undefined,
): string {
  const durationLabel = formatWindowDurationLabel(windowDurationMins);
  const trimmedLabel = trimString(rawLabel);
  if (!trimmedLabel) {
    return durationLabel ?? "Usage";
  }

  const normalized = trimmedLabel.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "primary" || normalized === "secondary" || normalized === "ratelimitinfo") {
    return durationLabel ?? "Usage";
  }
  if (normalized === "overage") {
    return "Overage";
  }

  const tokens = normalized.split(" ");
  let base = "";
  let suffixStartIndex = 0;
  if (tokens.length >= 2 && NUMBER_WORDS[tokens[0]!] && UNIT_SUFFIXES[tokens[1]!]) {
    base = `${NUMBER_WORDS[tokens[0]!]}${UNIT_SUFFIXES[tokens[1]!]}`;
    suffixStartIndex = 2;
  } else if (tokens.length >= 2 && /^\d+$/.test(tokens[0]!) && UNIT_SUFFIXES[tokens[1]!]) {
    base = `${tokens[0]}${UNIT_SUFFIXES[tokens[1]!]}`;
    suffixStartIndex = 2;
  } else if (/^\d+[mhdw]$/.test(tokens[0]!)) {
    base = tokens[0]!;
    suffixStartIndex = 1;
  }

  if (base) {
    const suffix = tokens
      .slice(suffixStartIndex)
      .filter((token) => token !== "limit" && token !== "window")
      .map(titleCaseWord)
      .join(" ");
    return suffix.length > 0 ? `${base} ${suffix}` : base;
  }

  return durationLabel ?? toTitleCase(normalized);
}

function normalizeWindowId(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "usage";
}

function toIsoDateTime(value: unknown): string | null {
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined) {
    const millis =
      numeric > 1_000_000_000_000 ? numeric : numeric > 1_000_000_000 ? numeric * 1_000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const trimmed = trimString(value);
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function isSyncingStateText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeLookupKey(value);
  return (
    normalized.includes("syncing") ||
    normalized.includes("loading") ||
    normalized.includes("pending") ||
    normalized.includes("refreshing") ||
    normalized.includes("checking") ||
    normalized.includes("fetching")
  );
}

function isUnavailableStateText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeLookupKey(value);
  return (
    normalized.includes("unavailable") ||
    normalized.includes("unsupported") ||
    normalized.includes("disabled") ||
    normalized.includes("failed") ||
    normalized.includes("missing") ||
    normalized.includes("notavailable") ||
    normalized === "error"
  );
}

function isExhaustedStatus(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeLookupKey(value);
  return (
    normalized === "rejected" ||
    normalized === "exhausted" ||
    normalized === "outofcredits" ||
    normalized === "limitreached"
  );
}

function resolveUsageLevel(
  percentUsed: number | null,
  exhausted: boolean,
): ServerProviderUsageLevel {
  if (exhausted || (percentUsed !== null && percentUsed >= 100)) {
    return "exhausted";
  }
  if (percentUsed !== null && percentUsed >= 85) {
    return "critical";
  }
  if (percentUsed !== null && percentUsed >= 70) {
    return "warning";
  }
  return "normal";
}

function looksLikeWindowRecord(record: Record<string, unknown>): boolean {
  return (
    firstMatchingNumber(record, PERCENT_KEYS) !== undefined ||
    firstMatchingNumber(record, RATIO_KEYS) !== undefined ||
    firstMatchingNumber(record, WINDOW_DURATION_KEYS) !== undefined ||
    firstMatchingValue(record, RESET_KEYS) !== undefined ||
    firstMatchingBoolean(record, EXHAUSTED_KEYS) !== undefined ||
    trimString(record.rateLimitType) !== undefined ||
    trimString(record.rate_limit_type) !== undefined ||
    trimString(record.overageStatus) !== undefined ||
    trimString(record.overage_status) !== undefined
  );
}

function collectWindowCandidates(
  value: unknown,
  hint?: string,
  seen = new WeakSet<Record<string, unknown>>(),
): ReadonlyArray<WindowCandidate> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectWindowCandidates(entry, hint, seen));
  }

  if (!isRecord(value)) {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const candidates: WindowCandidate[] = [];
  if (looksLikeWindowRecord(value)) {
    candidates.push({ hint, value });
    const overageStatus = trimString(value.overageStatus) ?? trimString(value.overage_status);
    if (
      overageStatus ||
      value.overageResetsAt !== undefined ||
      value.overage_resets_at !== undefined
    ) {
      candidates.push({
        hint: "overage",
        value: {
          label: "overage",
          status: overageStatus,
          resetsAt: value.overageResetsAt ?? value.overage_resets_at,
          exhausted: isExhaustedStatus(overageStatus),
        },
      });
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }

    if (Array.isArray(entry) || isRecord(entry) || WINDOW_CONTAINER_KEYS.has(key)) {
      candidates.push(...collectWindowCandidates(entry, key, seen));
    }
  }

  return candidates;
}

function normalizeWindow(
  candidate: WindowCandidate,
): ServerProviderUsage["windows"][number] | undefined {
  if (!isRecord(candidate.value)) {
    return undefined;
  }

  const percentValue = firstMatchingNumber(candidate.value, PERCENT_KEYS);
  const ratioValue = firstMatchingNumber(candidate.value, RATIO_KEYS);
  const derivedPercent =
    percentValue ??
    (ratioValue !== undefined ? (ratioValue <= 1 ? ratioValue * 100 : ratioValue) : undefined);
  const percentUsed = derivedPercent === undefined ? null : clampPercent(derivedPercent);

  const windowDurationMins = firstMatchingNumber(candidate.value, WINDOW_DURATION_KEYS);
  const label = normalizeWindowLabel(
    trimString(candidate.value.rateLimitType) ??
      trimString(candidate.value.rate_limit_type) ??
      trimString(candidate.value.label) ??
      trimString(candidate.value.limitName) ??
      trimString(candidate.value.limit_name) ??
      trimString(candidate.value.name) ??
      trimString(candidate.value.windowLabel) ??
      trimString(candidate.value.window_label) ??
      trimString(candidate.value.window) ??
      trimString(candidate.value.kind) ??
      trimString(candidate.value.id) ??
      trimString(candidate.value.limitId) ??
      trimString(candidate.value.limit_id) ??
      candidate.hint,
    windowDurationMins,
  );
  const id = normalizeWindowId(label);
  const resetsAt = toIsoDateTime(firstMatchingValue(candidate.value, RESET_KEYS));
  const statusText = firstMatchingString(candidate.value, STATUS_KEYS);
  const exhausted =
    firstMatchingBoolean(candidate.value, EXHAUSTED_KEYS) === true ||
    isExhaustedStatus(statusText) ||
    (percentUsed !== null && percentUsed >= 100);

  if (percentUsed === null && resetsAt === null && !exhausted && label === "Usage") {
    return undefined;
  }

  return {
    id,
    label,
    percentUsed,
    resetsAt,
    level: resolveUsageLevel(percentUsed, exhausted),
    exhausted,
  };
}

function windowCompletenessScore(window: ServerProviderUsage["windows"][number]): number {
  return (
    (window.percentUsed !== null ? 4 : 0) +
    (window.resetsAt !== null ? 2 : 0) +
    (window.exhausted ? 1 : 0)
  );
}

function readUsageState(value: unknown): ServerProviderUsage["state"] | undefined {
  if (typeof value === "string") {
    if (isSyncingStateText(value)) {
      return "syncing";
    }
    if (isUnavailableStateText(value)) {
      return "unavailable";
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const directState = firstMatchingString(value, new Set(["state", "status"]));
  if (isSyncingStateText(directState)) {
    return "syncing";
  }
  if (isUnavailableStateText(directState)) {
    return "unavailable";
  }
  return undefined;
}

function readUsageMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isSyncingStateText(value) || isUnavailableStateText(value)
      ? undefined
      : trimString(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return firstMatchingString(value, MESSAGE_KEYS) ?? firstMatchingString(value, STATUS_KEYS);
}

export function normalizeProviderUsageSnapshot(
  value: unknown,
  checkedAt: string,
): ServerProviderUsage {
  const windowsById = new Map<string, ServerProviderUsage["windows"][number]>();
  for (const candidate of collectWindowCandidates(value)) {
    const normalizedWindow = normalizeWindow(candidate);
    if (!normalizedWindow) {
      continue;
    }

    const existing = windowsById.get(normalizedWindow.id);
    if (
      !existing ||
      windowCompletenessScore(normalizedWindow) > windowCompletenessScore(existing)
    ) {
      windowsById.set(normalizedWindow.id, normalizedWindow);
    }
  }

  const windows = [...windowsById.values()];
  const explicitState = readUsageState(value);
  const message = readUsageMessage(value);
  const state =
    explicitState ?? (windows.length > 0 ? ("available" as const) : ("unavailable" as const));

  return {
    state,
    checkedAt,
    windows,
    ...(message ? { message } : {}),
  };
}

export function mergeProviderRuntimeEventIntoSnapshot(
  provider: ServerProvider,
  event: ProviderRuntimeEvent,
): ServerProvider {
  if (provider.provider !== event.provider) {
    return provider;
  }

  if (event.type === "account.rate-limits.updated") {
    return {
      ...provider,
      usage: normalizeProviderUsageSnapshot(event.payload.rateLimits, event.createdAt),
    };
  }

  if (
    event.type !== "account.updated" ||
    provider.provider !== "codex" ||
    !isRecord(event.payload.account)
  ) {
    return provider;
  }

  const authMetadata = codexAccountAuthMetadata({
    authMode: event.payload.account.authMode,
    planType: event.payload.account.planType,
  });
  const authChanged =
    authMetadata !== undefined &&
    (provider.auth.type !== authMetadata.type || provider.auth.label !== authMetadata.label);
  const shouldClearUsage = authMetadata?.type === "apiKey" && provider.usage !== undefined;
  if (!authChanged && !shouldClearUsage) {
    return provider;
  }

  const nextAuth = authMetadata ? { ...provider.auth, ...authMetadata } : provider.auth;
  const nextProviderBase = authChanged ? { ...provider, auth: nextAuth } : provider;
  if (!shouldClearUsage) {
    return nextProviderBase;
  }

  const { usage: _usage, ...providerWithoutUsage } = nextProviderBase;
  return providerWithoutUsage;
}
