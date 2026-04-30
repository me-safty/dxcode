import {
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderVersionAdvisory,
} from "@t3tools/contracts";
import { resolveCommandPath } from "@t3tools/shared/shell";

import { compareCliVersions } from "./cliVersion.ts";

const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;
const PROVIDER_UPDATE_ACTION_TOAST_MESSAGE = "Install the update now or review provider settings.";

type VersionLifecycleProvider = "codex" | "claudeAgent" | "cursor" | "opencode";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");

export interface ProviderVersionLifecycle {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly updateCommand: string | null;
  readonly updateExecutable: string | null;
  readonly updateArgs: ReadonlyArray<string>;
  readonly updateLockKey: string | null;
}

interface ProviderVersionLifecycleResolutionOptions {
  readonly binaryPath?: string | null;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

interface PackageManagedProviderVersionLifecycleDefinition {
  readonly provider: ProviderDriverKind;
  readonly packageName: string;
}

const PROVIDER_VERSION_LIFECYCLES = {
  codex: {
    provider: CODEX_DRIVER,
    packageName: "@openai/codex",
  },
  claudeAgent: {
    provider: CLAUDE_AGENT_DRIVER,
    packageName: "@anthropic-ai/claude-code",
  },
  cursor: {
    provider: CURSOR_DRIVER,
    packageName: null,
    updateCommand: "agent update",
    updateExecutable: "agent",
    updateArgs: ["update"],
    updateLockKey: "cursor-agent",
  },
  opencode: {
    provider: OPENCODE_DRIVER,
    packageName: "opencode-ai",
  },
} as const satisfies Record<
  Exclude<VersionLifecycleProvider, "cursor">,
  PackageManagedProviderVersionLifecycleDefinition
> & {
  readonly cursor: ProviderVersionLifecycle;
};

interface LatestVersionCacheEntry {
  readonly expiresAt: number;
  readonly version: string | null;
}

const latestVersionCache = new Map<string, LatestVersionCacheEntry>();

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isVersionLifecycleProvider(provider: string): provider is VersionLifecycleProvider {
  return provider in PROVIDER_VERSION_LIFECYCLES;
}

function makeProviderVersionLifecycle(input: {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly updateExecutable: string | null;
  readonly updateArgs: ReadonlyArray<string>;
  readonly updateLockKey: string | null;
}): ProviderVersionLifecycle {
  return {
    provider: input.provider,
    packageName: input.packageName,
    updateCommand:
      input.updateExecutable === null
        ? null
        : [input.updateExecutable, ...input.updateArgs].join(" "),
    updateExecutable: input.updateExecutable,
    updateArgs: input.updateArgs,
    updateLockKey: input.updateLockKey,
  };
}

function makeManualOnlyProviderVersionLifecycle(input: {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
}): ProviderVersionLifecycle {
  return makeProviderVersionLifecycle({
    provider: input.provider,
    packageName: input.packageName,
    updateExecutable: null,
    updateArgs: [],
    updateLockKey: null,
  });
}

function makeNpmGlobalProviderVersionLifecycle(
  definition: PackageManagedProviderVersionLifecycleDefinition,
): ProviderVersionLifecycle {
  return makeProviderVersionLifecycle({
    provider: definition.provider,
    packageName: definition.packageName,
    updateExecutable: "npm",
    updateArgs: ["install", "-g", `${definition.packageName}@latest`],
    updateLockKey: "npm-global",
  });
}

function makeBunGlobalProviderVersionLifecycle(
  definition: PackageManagedProviderVersionLifecycleDefinition,
): ProviderVersionLifecycle {
  return makeProviderVersionLifecycle({
    provider: definition.provider,
    packageName: definition.packageName,
    updateExecutable: "bun",
    updateArgs: ["add", "-g", `${definition.packageName}@latest`],
    updateLockKey: "bun-global",
  });
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isBunGlobalCommandPath(commandPath: string): boolean {
  return commandPath.replaceAll("\\", "/").toLowerCase().includes("/.bun/bin/");
}

function resolvePackageManagedProviderVersionLifecycle(
  definition: PackageManagedProviderVersionLifecycleDefinition,
  options?: ProviderVersionLifecycleResolutionOptions,
): ProviderVersionLifecycle {
  const binaryPath = nonEmptyString(options?.binaryPath);
  if (!binaryPath) {
    return makeNpmGlobalProviderVersionLifecycle(definition);
  }

  const resolvedCommandPath =
    resolveCommandPath(binaryPath, {
      ...(options?.platform ? { platform: options.platform } : {}),
      ...(options?.env ? { env: options.env } : {}),
    }) ?? (hasPathSeparator(binaryPath) ? binaryPath : null);
  if (resolvedCommandPath && isBunGlobalCommandPath(resolvedCommandPath)) {
    return makeBunGlobalProviderVersionLifecycle(definition);
  }

  if (!hasPathSeparator(binaryPath)) {
    return makeNpmGlobalProviderVersionLifecycle(definition);
  }

  return makeManualOnlyProviderVersionLifecycle(definition);
}

export function haveProviderVersionLifecyclesEqual(
  left: ProviderVersionLifecycle,
  right: ProviderVersionLifecycle,
): boolean {
  return (
    left.provider === right.provider &&
    left.packageName === right.packageName &&
    left.updateCommand === right.updateCommand &&
    left.updateExecutable === right.updateExecutable &&
    left.updateLockKey === right.updateLockKey &&
    left.updateArgs.length === right.updateArgs.length &&
    left.updateArgs.every((value, index) => value === right.updateArgs[index])
  );
}

export function disableProviderVersionLifecycleUpdates(
  lifecycle: ProviderVersionLifecycle,
): ProviderVersionLifecycle {
  return makeManualOnlyProviderVersionLifecycle({
    provider: lifecycle.provider,
    packageName: lifecycle.packageName,
  });
}

export function getProviderVersionLifecycle(
  provider: ProviderDriverKind,
  options?: ProviderVersionLifecycleResolutionOptions,
): ProviderVersionLifecycle {
  const providerKey = String(provider);
  if (isVersionLifecycleProvider(providerKey)) {
    if (providerKey === "cursor") {
      return PROVIDER_VERSION_LIFECYCLES.cursor;
    }
    return resolvePackageManagedProviderVersionLifecycle(
      PROVIDER_VERSION_LIFECYCLES[providerKey],
      options,
    );
  }
  return makeManualOnlyProviderVersionLifecycle({
    provider,
    packageName: null,
  });
}

function deriveVersionAdvisory(input: {
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
}): Pick<ServerProviderVersionAdvisory, "status" | "message"> {
  if (!input.currentVersion) {
    return { status: "unknown", message: null };
  }
  if (!input.latestVersion) {
    return { status: "unknown", message: null };
  }
  if (compareCliVersions(input.currentVersion, input.latestVersion) < 0) {
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
  readonly versionLifecycle?: ProviderVersionLifecycle;
}): ServerProviderVersionAdvisory {
  const lifecycle = input.versionLifecycle ?? getProviderVersionLifecycle(input.driver);
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
  versionLifecycle?: ProviderVersionLifecycle,
): Promise<ServerProvider> {
  const lifecycle = versionLifecycle ?? getProviderVersionLifecycle(snapshot.driver);
  if (!snapshot.enabled || !snapshot.installed || !snapshot.version) {
    return {
      ...snapshot,
      versionAdvisory: createProviderVersionAdvisory({
        driver: snapshot.driver,
        currentVersion: snapshot.version,
        checkedAt: snapshot.checkedAt,
        versionLifecycle: lifecycle,
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
      versionLifecycle: lifecycle,
    }),
  };
}
