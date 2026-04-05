/**
 * OpenCodeProviderLive - Provider snapshot layer for OpenCode.
 *
 * Probes the `opencode` CLI for installation, version, authentication, and
 * discovers available models by running `opencode models --verbose`.
 * Models are parsed with their capabilities (reasoning, context window,
 * tool calling) and mapped to T3's ModelCapabilities.
 *
 * @module OpenCodeProviderLive
 */
import type {
  ModelCapabilities,
  OpenCodeSettings,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderState,
} from "@t3tools/contracts";
import { ServerSettingsError } from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { OpenCodeProvider } from "../Services/OpenCodeProvider.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "opencode" as const;
const MODELS_TIMEOUT_MS = 10_000;

// ── OpenCode model JSON types ─────────────────────────────────────────

interface OpenCodeModelJson {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  status?: string;
  limit?: {
    context?: number;
    output?: number;
    input?: number;
  };
  capabilities?: {
    reasoning?: boolean;
    toolcall?: boolean;
    attachment?: boolean;
    temperature?: boolean;
  };
  cost?: {
    input?: number;
    output?: number;
  };
}

// ── Capability mapping ────────────────────────────────────────────────

function contextWindowLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function buildModelCapabilities(model: OpenCodeModelJson): ModelCapabilities {
  const hasReasoning = model.capabilities?.reasoning === true;
  const contextTokens = model.limit?.context ?? 0;

  // Reasoning effort levels (only for models that support reasoning)
  const reasoningEffortLevels = hasReasoning
    ? [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true as const },
      ]
    : [];

  // Context window options (only if context > 0)
  const contextWindowOptions =
    contextTokens > 0
      ? [
          {
            value: contextWindowLabel(contextTokens),
            label: contextWindowLabel(contextTokens),
            isDefault: true as const,
          },
        ]
      : [];

  return {
    reasoningEffortLevels,
    supportsFastMode: false,
    supportsThinkingToggle: hasReasoning,
    contextWindowOptions,
    promptInjectedEffortLevels: [],
  };
}

function buildDisplayName(model: OpenCodeModelJson): string {
  // Use the model's name if available, otherwise format the ID
  if (model.name && model.name.length > 0 && model.name !== model.id) {
    return model.name;
  }
  // Format: provider/model-id → "Provider Model-Id"
  return model.id
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Parse the verbose output of `opencode models --verbose`.
 * Format: alternating lines of "provider/model-id" followed by JSON blocks.
 */
function parseOpenCodeModelsOutput(stdout: string): ServerProviderModel[] {
  const models: ServerProviderModel[] = [];
  const lines = stdout.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();

    // Look for provider/model-id lines
    if (line.length > 0 && !line.startsWith("{") && line.includes("/")) {
      const slug = line; // e.g. "opencode/claude-opus-4-6"

      // Collect the JSON block that follows
      let jsonStr = "";
      let braceDepth = 0;
      let foundJson = false;

      for (let j = i + 1; j < lines.length; j++) {
        const jsonLine = lines[j]!;
        if (!foundJson && jsonLine.trim().startsWith("{")) {
          foundJson = true;
        }
        if (foundJson) {
          jsonStr += jsonLine + "\n";
          for (const ch of jsonLine) {
            if (ch === "{") braceDepth++;
            if (ch === "}") braceDepth--;
          }
          if (braceDepth <= 0 && jsonStr.trim().length > 0) {
            i = j + 1;
            break;
          }
        }
        // Exhausted lines without balanced braces — advance past them
        if (j === lines.length - 1) {
          i = j + 1;
        }
      }

      if (jsonStr.trim().length > 0) {
        try {
          const parsed = JSON.parse(jsonStr) as OpenCodeModelJson;
          parsed.providerID = parsed.providerID ?? slug.split("/")[0] ?? "";

          const capabilities = buildModelCapabilities(parsed);
          const contextTokens = parsed.limit?.context ?? 0;
          const costInfo =
            parsed.cost && (parsed.cost.input || parsed.cost.output)
              ? ` · $${parsed.cost.input ?? 0}/$${parsed.cost.output ?? 0} per 1M tokens`
              : "";
          const contextInfo =
            contextTokens > 0 ? ` · ${contextWindowLabel(contextTokens)} ctx` : "";

          models.push({
            slug,
            name: `${buildDisplayName(parsed)}${contextInfo}${costInfo}`,
            isCustom: false,
            capabilities,
          });
        } catch {
          // Skip unparseable entries
          models.push({
            slug,
            name: slug,
            isCustom: false,
            capabilities: {
              reasoningEffortLevels: [],
              supportsFastMode: false,
              supportsThinkingToggle: false,
              contextWindowOptions: [],
              promptInjectedEffortLevels: [],
            },
          });
        }
        continue;
      }
    }

    i++;
  }

  return models;
}

// ── Auth status parsing ───────────────────────────────────────────────

export function parseOpenCodeAuthStatus(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("no providers") ||
    lowerOutput.includes("no credentials") ||
    lowerOutput.includes("not authenticated") ||
    lowerOutput.includes("no api key")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "OpenCode has no configured providers. Run `opencode auth login` to add one.",
    };
  }

  if (result.code === 0) {
    return { status: "ready", auth: { status: "authenticated" } };
  }

  const detail = `${result.stdout}\n${result.stderr}`.trim();
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify OpenCode authentication status. ${detail}`
      : "Could not verify OpenCode authentication status.",
  };
}

// ── CLI runner ────────────────────────────────────────────────────────

const runOpenCodeCommand = Effect.fn("runOpenCodeCommand")(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService;
  const opencodeSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => settings.providers.opencode),
  );
  const command = ChildProcess.make(opencodeSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(opencodeSettings.binaryPath, command);
});

// ── Provider status check ─────────────────────────────────────────────

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const settingsService = yield* ServerSettingsService;
    const opencodeSettings = yield* settingsService.getSettings.pipe(
      Effect.map((settings) => settings.providers.opencode),
    );
    const checkedAt = new Date().toISOString();

    if (!opencodeSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models: [],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "OpenCode is disabled in T3 Code settings.",
        },
      });
    }

    // ── Version check ─────────────────────────────────────────────────
    const versionProbe = yield* runOpenCodeCommand(["--version"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: opencodeSettings.enabled,
        checkedAt,
        models: [],
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "OpenCode CLI (`opencode`) is not installed or not on PATH. Install from https://opencode.ai"
            : `Failed to execute OpenCode CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(versionProbe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: opencodeSettings.enabled,
        checkedAt,
        models: [],
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "OpenCode CLI is installed but timed out.",
        },
      });
    }

    const version = versionProbe.success.value;
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    if (version.code !== 0) {
      const detail = `${version.stdout}\n${version.stderr}`.trim();
      return buildServerProvider({
        provider: PROVIDER,
        enabled: opencodeSettings.enabled,
        checkedAt,
        models: [],
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unknown" },
          message: detail
            ? `OpenCode CLI is installed but failed to run. ${detail}`
            : "OpenCode CLI is installed but failed to run.",
        },
      });
    }

    // ── Auth check ────────────────────────────────────────────────────
    const authProbe = yield* runOpenCodeCommand(["auth", "list"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    let authStatus: ReturnType<typeof parseOpenCodeAuthStatus> = {
      status: "warning",
      auth: { status: "unknown" },
    };
    if (Result.isSuccess(authProbe) && Option.isSome(authProbe.success)) {
      authStatus = parseOpenCodeAuthStatus(authProbe.success.value);
    }

    // ── Model discovery ───────────────────────────────────────────────
    const modelsProbe = yield* runOpenCodeCommand(["models", "--verbose"]).pipe(
      Effect.timeoutOption(MODELS_TIMEOUT_MS),
      Effect.result,
    );

    let discoveredModels: ServerProviderModel[] = [];
    let modelCount = 0;

    if (Result.isSuccess(modelsProbe) && Option.isSome(modelsProbe.success)) {
      const modelsResult = modelsProbe.success.value;
      if (modelsResult.code === 0) {
        discoveredModels = parseOpenCodeModelsOutput(modelsResult.stdout);
        modelCount = discoveredModels.length;
      }
    }

    // Merge with any custom models from settings
    const allModels = providerModelsFromSettings(
      discoveredModels,
      PROVIDER,
      opencodeSettings.customModels,
    );

    return buildServerProvider({
      provider: PROVIDER,
      enabled: opencodeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: authStatus.status,
        auth: authStatus.auth,
        message:
          authStatus.message ??
          `${modelCount} model(s) available across ${new Set(discoveredModels.map((m) => m.slug.split("/")[0])).size} provider(s).`,
      },
    });
  },
);

// ── Layer ─────────────────────────────────────────────────────────────

export const OpenCodeProviderLive = Layer.effect(
  OpenCodeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkOpenCodeProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<OpenCodeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.opencode),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.opencode),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
