import type {
  ProviderDriverKind,
  ServerProvider,
  ServerProviderVersionAdvisory,
  ServerProviderVersionAdvisoryStatus,
} from "@t3tools/contracts";

import testedVersions from "./providerTestedVersions.generated.json" with { type: "json" };
import { compareCliVersions } from "./cliVersion.ts";

const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;

type VersionLifecycleProvider = "codex" | "claudeAgent" | "cursor" | "opencode";

type TestedVersionsManifest = {
  readonly providers?: Partial<
    Record<VersionLifecycleProvider, { readonly testedVersion?: string | null } | undefined>
  >;
};

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

export function getProviderTestedVersion(provider: ProviderDriverKind): string | null {
  if (!isVersionLifecycleProvider(provider)) {
    return null;
  }
  const manifest = testedVersions as TestedVersionsManifest;
  return nonEmptyString(manifest.providers?.[provider]?.testedVersion);
}

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function deriveVersionAdvisoryStatus(input: {
  readonly currentVersion: string | null;
  readonly testedVersion: string | null;
  readonly latestVersion: string | null;
}): ServerProviderVersionAdvisoryStatus {
  if (!input.currentVersion) {
    return "unknown";
  }
  if (input.testedVersion && compareCliVersions(input.currentVersion, input.testedVersion) < 0) {
    return "behind_tested";
  }
  if (input.latestVersion && compareCliVersions(input.currentVersion, input.latestVersion) < 0) {
    return "behind_latest";
  }
  return "current";
}

function advisoryMessage(input: {
  readonly status: ServerProviderVersionAdvisoryStatus;
  readonly testedVersion: string | null;
  readonly latestVersion: string | null;
}): string | null {
  switch (input.status) {
    case "behind_tested":
      return input.testedVersion
        ? `Recommended update: this T3 Code build was tested with ${formatVersion(input.testedVersion)}.`
        : "Recommended update: this provider is behind the version tested with this T3 Code build.";
    case "behind_latest":
      return input.latestVersion
        ? `Update available: latest is ${formatVersion(input.latestVersion)}.`
        : "Update available.";
    case "unknown":
      return null;
    case "current":
      return null;
  }
}

export function createProviderVersionAdvisory(input: {
  readonly driver: ProviderDriverKind;
  readonly currentVersion: string | null;
  readonly latestVersion?: string | null;
  readonly checkedAt?: string | null;
}): ServerProviderVersionAdvisory {
  const lifecycle = getProviderVersionLifecycle(input.driver);
  const testedVersion = getProviderTestedVersion(input.driver);
  const latestVersion = input.latestVersion ?? null;
  const status = deriveVersionAdvisoryStatus({
    currentVersion: input.currentVersion,
    testedVersion,
    latestVersion,
  });

  return {
    status,
    currentVersion: input.currentVersion,
    testedVersion,
    latestVersion,
    updateCommand: lifecycle.updateCommand,
    canUpdate: lifecycle.updateExecutable !== null,
    checkedAt: input.checkedAt ?? null,
    message: advisoryMessage({ status, testedVersion, latestVersion }),
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
): Promise<ServerProvider> {
  if (!snapshot.enabled || !snapshot.installed || !snapshot.version) {
    return {
      ...snapshot,
      versionAdvisory: createProviderVersionAdvisory({
        driver: snapshot.driver,
        currentVersion: snapshot.version,
        checkedAt: snapshot.checkedAt,
      }),
    };
  }

  const latestVersion = await resolveLatestProviderVersion(snapshot.driver);
  return {
    ...snapshot,
    versionAdvisory: createProviderVersionAdvisory({
      driver: snapshot.driver,
      currentVersion: snapshot.version,
      latestVersion,
      checkedAt: new Date().toISOString(),
    }),
  };
}
