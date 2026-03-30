import type { DroidSettings, ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { DroidProvider } from "../Services/DroidProvider";
import { ServerSettingsService } from "../../serverSettings";

const PROVIDER = "droid" as const;
const FALLBACK_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "claude-opus-4-6", name: "Claude Opus 4.6", isCustom: false, capabilities: null },
];

const MODEL_LINE_RE = /^\s{2}(\S+)\s{2,}(.+)$/;
const MODEL_DETAILS_LINE_RE =
  /^\s*-\s(.+?): supports reasoning: (Yes|No); supported: \[([^\]]*)\]; default: (\S+)$/;

function toEffortLabel(value: string): string {
  switch (value) {
    case "xhigh":
      return "Extra High";
    case "none":
    case "off":
      return "Off";
    default:
      return value
        .split("-")
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
  }
}

function parseCapabilitiesFromHelp(helpText: string): Map<string, ModelCapabilities> {
  const capabilitiesByName = new Map<string, ModelCapabilities>();
  let inSection = false;

  for (const line of helpText.split("\n")) {
    if (line.startsWith("Model details:")) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.trim() === "") continue;
    if (!line.trimStart().startsWith("- ")) {
      break;
    }

    const match = MODEL_DETAILS_LINE_RE.exec(line);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) continue;

    const name = match[1].trim();
    const supportsReasoning = match[2] === "Yes";
    const supportedValues = match[3]
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const defaultValue = match[4].trim();

    capabilitiesByName.set(name, {
      reasoningEffortLevels: supportsReasoning
        ? supportedValues.map((value) =>
            value === defaultValue
              ? { value, label: toEffortLabel(value), isDefault: true }
              : { value, label: toEffortLabel(value) },
          )
        : [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    });
  }

  return capabilitiesByName;
}

function normalizeCapabilityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveCapabilitiesForModel(
  slug: string,
  name: string,
  capabilitiesByName: Map<string, ModelCapabilities>,
): ModelCapabilities | null {
  const direct = capabilitiesByName.get(name);
  if (direct) {
    return direct;
  }

  const normalizedSlug = normalizeCapabilityKey(slug.replace(/^custom:/, ""));
  const normalizedName = normalizeCapabilityKey(name);

  for (const [candidateName, capabilities] of capabilitiesByName.entries()) {
    const normalizedCandidate = normalizeCapabilityKey(candidateName);
    if (
      normalizedCandidate === normalizedName ||
      normalizedCandidate === normalizedSlug ||
      normalizedName.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedName) ||
      normalizedSlug.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedSlug)
    ) {
      return capabilities;
    }
  }

  return null;
}

function parseModelsFromHelp(helpText: string): ReadonlyArray<ServerProviderModel> {
  const models: ServerProviderModel[] = [];
  const capabilitiesByName = parseCapabilitiesFromHelp(helpText);
  let inSection = false;

  for (const line of helpText.split("\n")) {
    if (line.startsWith("Available Models:")) {
      inSection = true;
      continue;
    }
    if (line.startsWith("Custom Models:")) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim() === "") {
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    const match = MODEL_LINE_RE.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const slug = match[1];
    let name = match[2].trim();
    if (name.includes("[Deprecated]")) continue;
    if (name.includes("(default)")) name = name.replace("(default)", "").trim();
    models.push({
      slug,
      name,
      isCustom: slug.startsWith("custom:"),
      capabilities: resolveCapabilitiesForModel(slug, name, capabilitiesByName),
    });
  }

  return models.length > 0 ? models : FALLBACK_MODELS;
}

const runDroidCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const droidSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.droid),
    );
    const command = ChildProcess.make(droidSettings.binaryPath, [...args], {
      shell: process.platform === "win32",
    });
    return yield* spawnAndCollect(droidSettings.binaryPath, command);
  });

export const checkDroidProviderStatus = Effect.gen(function* () {
  const droidSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.droid),
  );
  const checkedAt = new Date().toISOString();
  const disabledModels = providerModelsFromSettings(
    FALLBACK_MODELS,
    PROVIDER,
    droidSettings.customModels,
  );

  if (!droidSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models: disabledModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Droid is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runDroidCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: droidSettings.enabled,
      checkedAt,
      models: disabledModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Droid CLI (`droid`) is not installed or not on PATH."
          : `Failed to execute Droid CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: droidSettings.enabled,
      checkedAt,
      models: disabledModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Droid CLI is installed but timed out while running.",
      },
    });
  }

  const version = Option.getOrThrow(versionProbe.success);
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);

  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: droidSettings.enabled,
      checkedAt,
      models: disabledModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Droid CLI is installed but failed to run. ${detail}`
          : "Droid CLI is installed but failed to run.",
      },
    });
  }

  const helpProbe = yield* runDroidCommand(["exec", "--help"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  let builtInModels: ReadonlyArray<ServerProviderModel> = FALLBACK_MODELS;
  if (Result.isSuccess(helpProbe) && Option.isSome(helpProbe.success)) {
    const helpResult = Option.getOrThrow(helpProbe.success);
    builtInModels = parseModelsFromHelp(`${helpResult.stdout}\n${helpResult.stderr}`);
  }

  const models = providerModelsFromSettings(builtInModels, PROVIDER, droidSettings.customModels);

  return buildServerProvider({
    provider: PROVIDER,
    enabled: droidSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});

export const DroidProviderLive = Layer.effect(
  DroidProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkDroidProviderStatus.pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<DroidSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.droid),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.droid),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
