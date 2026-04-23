import type { ProviderDriverKind, ServerProviderUpdateState } from "@t3tools/contracts";

const DEV_PROVIDER_UPDATE_ADVISORY_ENV = "T3CODE_DEV_PROVIDER_UPDATE_ADVISORY";
const DEV_PROVIDER_UPDATE_RESULT_ENV = "T3CODE_DEV_PROVIDER_UPDATE_RESULT";
const DEV_PROVIDER_UPDATE_DELAY_MS_ENV = "T3CODE_DEV_PROVIDER_UPDATE_DELAY_MS";

const PROVIDER_KINDS = new Set<ProviderDriverKind>(["codex", "claudeAgent", "cursor", "opencode"]);
const SIMULATED_PROVIDER_UPDATE_STATUSES = new Set<
  Extract<ServerProviderUpdateState["status"], "succeeded" | "failed" | "unchanged">
>(["succeeded", "failed", "unchanged"]);

function nonEmptyString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isProviderDriverKind(value: string): value is ProviderDriverKind {
  return PROVIDER_KINDS.has(value as ProviderDriverKind);
}

function splitProviderOverrideEntry(entry: string): readonly [string, string] | null {
  const separatorIndex = entry.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
    return null;
  }

  const key = entry.slice(0, separatorIndex).trim();
  const value = entry.slice(separatorIndex + 1).trim();
  if (key.length === 0 || value.length === 0) {
    return null;
  }

  return [key, value];
}

function resolveProviderOverrideValue(
  rawValue: string | undefined,
  provider: ProviderDriverKind,
): string | null {
  const raw = nonEmptyString(rawValue);
  if (!raw) {
    return null;
  }

  let wildcardValue: string | null = null;
  for (const entry of raw.split(",")) {
    const parsed = splitProviderOverrideEntry(entry);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (key === "*") {
      wildcardValue = value;
      continue;
    }
    if (isProviderDriverKind(key) && key === provider) {
      return value;
    }
  }

  return wildcardValue;
}

export function resolveDevLatestProviderVersionOverride(
  provider: ProviderDriverKind,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveProviderOverrideValue(env[DEV_PROVIDER_UPDATE_ADVISORY_ENV], provider);
}

export function resolveDevSimulatedProviderUpdateStatus(
  provider: ProviderDriverKind,
  env: NodeJS.ProcessEnv = process.env,
): Extract<ServerProviderUpdateState["status"], "succeeded" | "failed" | "unchanged"> | null {
  const value = resolveProviderOverrideValue(env[DEV_PROVIDER_UPDATE_RESULT_ENV], provider);
  if (!value || !SIMULATED_PROVIDER_UPDATE_STATUSES.has(value as never)) {
    return null;
  }
  return value as Extract<
    ServerProviderUpdateState["status"],
    "succeeded" | "failed" | "unchanged"
  >;
}

export function resolveDevSimulatedProviderUpdateDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = nonEmptyString(env[DEV_PROVIDER_UPDATE_DELAY_MS_ENV]);
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}
