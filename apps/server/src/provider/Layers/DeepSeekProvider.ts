import {
  type DeepSeekSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

export const DEEPSEEK_DRIVER_KIND = ProviderDriverKind.make("deepseek");
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro[1m]";
export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";

const DEEPSEEK_PRESENTATION = {
  displayName: "DeepSeek",
  showInteractionModeToggle: true,
} as const;

const DEFAULT_DEEPSEEK_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEEPSEEK_PRO_MODEL,
    name: "DeepSeek V4 Pro 1M",
    isCustom: false,
    capabilities: DEFAULT_DEEPSEEK_MODEL_CAPABILITIES,
  },
  {
    slug: DEEPSEEK_FLASH_MODEL,
    name: "DeepSeek V4 Flash",
    isCustom: false,
    capabilities: DEFAULT_DEEPSEEK_MODEL_CAPABILITIES,
  },
];

export const makeDeepSeekClaudeEnvironment = Effect.fn("makeDeepSeekClaudeEnvironment")(function* (
  settings: Pick<DeepSeekSettings, "apiKey" | "homePath">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const claudeEnvironment = yield* makeClaudeEnvironment(settings, baseEnv);
  return {
    ...claudeEnvironment,
    ANTHROPIC_BASE_URL: DEEPSEEK_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: settings.apiKey,
    ANTHROPIC_MODEL: DEEPSEEK_PRO_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: DEEPSEEK_PRO_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: DEEPSEEK_PRO_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: DEEPSEEK_FLASH_MODEL,
    CLAUDE_CODE_SUBAGENT_MODEL: DEEPSEEK_FLASH_MODEL,
    CLAUDE_CODE_EFFORT_LEVEL: "max",
  };
});

const runClaudeCommand = Effect.fn("runDeepSeekClaudeCommand")(function* (
  settings: DeepSeekSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const deepSeekEnvironment = yield* makeDeepSeekClaudeEnvironment(settings, environment);
  const command = ChildProcess.make(settings.binaryPath, [...args], {
    env: deepSeekEnvironment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(settings.binaryPath, command);
});

export const checkDeepSeekProviderStatus = Effect.fn("checkDeepSeekProviderStatus")(function* (
  settings: DeepSeekSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    DEEPSEEK_DRIVER_KIND,
    settings.customModels,
    DEFAULT_DEEPSEEK_MODEL_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "DeepSeek is disabled in T3 Code settings.",
      },
    });
  }

  if (settings.apiKey.trim().length === 0) {
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "DeepSeek API key is missing.",
      },
    });
  }

  const versionProbe = yield* runClaudeCommand(settings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "authenticated", type: "apiKey", label: "DeepSeek API Key" },
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI (`claude`) is not installed or not on PATH."
          : `Failed to execute Claude Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "authenticated", type: "apiKey", label: "DeepSeek API Key" },
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "authenticated", type: "apiKey", label: "DeepSeek API Key" },
        message: detail
          ? `Claude Agent CLI is installed but failed to run. ${detail}`
          : "Claude Agent CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    presentation: DEEPSEEK_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: { status: "authenticated", type: "apiKey", label: "DeepSeek API Key" },
    },
  });
});

export const makePendingDeepSeekProvider = (
  settings: DeepSeekSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      DEEPSEEK_DRIVER_KIND,
      settings.customModels,
      DEFAULT_DEEPSEEK_MODEL_CAPABILITIES,
    );

    return buildServerProvider({
      presentation: DEEPSEEK_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: settings.apiKey.trim().length > 0 ? "warning" : "error",
        auth:
          settings.apiKey.trim().length > 0
            ? { status: "authenticated", type: "apiKey", label: "DeepSeek API Key" }
            : { status: "unauthenticated" },
        message:
          settings.apiKey.trim().length > 0
            ? "DeepSeek provider status has not been checked in this session yet."
            : "DeepSeek API key is missing.",
      },
    });
  });
