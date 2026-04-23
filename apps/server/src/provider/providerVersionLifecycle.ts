import type {
  ProviderDriverKind,
  ServerProvider,
  ServerProviderVersionAdvisory,
} from "@t3tools/contracts";

import { compareCliVersions } from "./cliVersion.ts";
import { resolveDevLatestProviderVersionOverride } from "./providerUpdateDevOverrides.ts";

const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;
const PROVIDER_UPDATE_ACTION_TOAST_MESSAGE = "Install the update now or review provider settings.";

type VersionLifecycleProvider = "codex" | "claudeAgent" | "cursor" | "opencode";

export interface ProviderVersionLifecycle {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly updateCommand: string | null;
  readonly updateExecutable: string | null;
  readonly updateArgs: ReadonlyArray<string>;
  readonly updateLockKey: string | null;
}

const PROVIDER_VERSION_LIFECYCLES = {
  codex: {
    provider: "codex",
    packageName: "@openai/codex",
    updateCommand: "npm install -g @openai/codex@latest",
    updateExecutable: "npm",
    updateArgs: ["install", "-g", "@openai/codex@latest"],
    updateLockKey: "npm-global",
  },
  claudeAgent: {
    provider: "claudeAgent",
    packageName: "@anthropic-ai/claude-code",
    updateCommand: "npm install -g @anthropic-ai/claude-code@latest",
    updateExecutable: "npm",
    updateArgs: ["install", "-g", "@anthropic-ai/claude-code@latest"],
    updateLockKey: "npm-global",
  },
  cursor: {
    provider: "cursor",
    packageName: null,
    updateCommand: "agent update",
    updateExecutable: "agent",
    updateArgs: ["update"],
    updateLockKey: "cursor-agent",
  },
  opencode: {
    provider: "opencode",
    packageName: "opencode-ai",
    updateCommand: "npm install -g opencode-ai@latest",
    updateExecutable: "npm",
    updateArgs: ["install", "-g", "opencode-ai@latest"],
    updateLockKey: "npm-global",
  },
} as const satisfies Record<VersionLifecycleProvider, ProviderVersionLifecycle>;

interface LatestVersionCacheEntry {
  readonly expiresAt: number;
  readonly version: string | null;
}

const latestVersionCache = new Map<string, LatestVersionCacheEntry>();

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isVersionLifecycleProvider(
  provider: ProviderDriverKind | string,
): provider is VersionLifecycleProvider {
  return provider in PROVIDER_VERSION_LIFECYCLES;
}

export function getProviderVersionLifecycle(provider: ProviderDriverKind): ProviderVersionLifecycle {
  if (isVersionLifecycleProvider(provider)) {
    return PROVIDER_VERSION_LIFECYCLES[provider];
  }
  return {
    provider,
    packageName: null,
    updateCommand: null,
    updateExecutable: null,
    updateArgs: [],
    updateLockKey: null,
  };
}

function deriveVersionAdvisory(input: {
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
}): Pick<ServerProviderVersionAdvisory, "status" | "message"> {
  if (!input.currentVersion) {
    return { status: "unknown", message: null };
  }
  if (input.latestVersion && compareCliVersions(input.currentVersion, input.latestVersion) < 0) {
    return {
      status: "behind_latest",
      message: PROVIDER_UPDATE_ACTION_TOAST_MESSAGE,
    };
  }
  return { status: "current", message: null };
}

export function createProviderVersionAdvisory(input: {
  readonly driver: ProviderDriverKind;
  readonly currentVersion: string | null;
  readonly latestVersion?: string | null;
  readonly checkedAt?: string | null;
}): ServerProviderVersionAdvisory {
  const lifecycle = getProviderVersionLifecycle(input.driver);
  const latestVersion = input.latestVersion ?? null;
  const advisory = deriveVersionAdvisory({
    currentVersion: input.currentVersion,
    latestVersion,
  });

  return {
    status: advisory.status,
    currentVersion: input.currentVersion,
    latestVersion,
    updateCommand: lifecycle.updateCommand,
    canUpdate: lifecycle.updateExecutable !== null,
    checkedAt: input.checkedAt ?? null,
    message: advisory.message,
  };
}

export function applyDevProviderVersionAdvisoryOverride(
  snapshot: ServerProvider,
  env: NodeJS.ProcessEnv = process.env,
): ServerProvider {
  const forcedLatestVersion = resolveDevLatestProviderVersionOverride(snapshot.driver, env);
  if (!forcedLatestVersion) {
    return snapshot;
  }

  return {
    ...snapshot,
    versionAdvisory: createProviderVersionAdvisory({
      driver: snapshot.driver,
      currentVersion: snapshot.version,
      latestVersion: forcedLatestVersion,
      checkedAt: snapshot.checkedAt,
    }),
  };
}

async function fetchNpmLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LATEST_VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        signal: controller.signal,
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { version?: unknown };
    return nonEmptyString(payload.version);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveLatestProviderVersion(
  provider: ProviderDriverKind,
): Promise<string | null> {
  const lifecycle = getProviderVersionLifecycle(provider);
  if (!lifecycle.packageName) {
    return null;
  }

  const cached = latestVersionCache.get(lifecycle.packageName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.version;
  }

  const version = await fetchNpmLatestVersion(lifecycle.packageName);
  latestVersionCache.set(lifecycle.packageName, {
    expiresAt: now + LATEST_VERSION_CACHE_TTL_MS,
    version,
  });
  return version;
}

export async function enrichProviderSnapshotWithVersionAdvisory(
  snapshot: ServerProvider,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServerProvider> {
  const forcedLatestVersion = resolveDevLatestProviderVersionOverride(snapshot.driver, env);
  if (!snapshot.enabled || !snapshot.installed || !snapshot.version) {
    return applyDevProviderVersionAdvisoryOverride(
      {
        ...snapshot,
        versionAdvisory: createProviderVersionAdvisory({
          driver: snapshot.driver,
          currentVersion: snapshot.version,
          ...(forcedLatestVersion ? { latestVersion: forcedLatestVersion } : {}),
          checkedAt: snapshot.checkedAt,
        }),
      },
      env,
    );
  }

  const latestVersion =
    forcedLatestVersion ?? (await resolveLatestProviderVersion(snapshot.driver));
  return applyDevProviderVersionAdvisoryOverride(
    {
      ...snapshot,
      versionAdvisory: createProviderVersionAdvisory({
        driver: snapshot.driver,
        currentVersion: snapshot.version,
        latestVersion,
        checkedAt: new Date().toISOString(),
      }),
    },
    env,
  );
}
