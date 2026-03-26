import type {
  CopilotSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuthStatus,
  ServerProviderModel,
  ServerProviderState,
} from "@t3tools/contracts";
import { CopilotClient } from "@github/copilot-sdk";
import { Data, Effect, Equal, Layer, Option, Result, Stream } from "effect";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  providerModelsFromSettings,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { CopilotProvider } from "../Services/CopilotProvider";
import { ServerSettingsError, ServerSettingsService } from "../../serverSettings";
import { normalizeCopilotCliPathOverride, resolveBundledCopilotCliPath } from "./copilotCliPath";

const PROVIDER = "copilot" as const;
class CopilotProviderProbeError extends Data.TaggedError("CopilotProviderProbeError")<{
  cause: unknown;
}> {}

const toProbeError = (cause: unknown): CopilotProviderProbeError =>
  new CopilotProviderProbeError({ cause });

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "claude-opus-4.6-fast",
    name: "Claude Opus 4.6 (Fast Mode)",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
  {
    slug: "gemini-3.0",
    name: "Gemini 3.0 Pro",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
];

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(
  function* (): Effect.fn.Return<ServerProvider, ServerSettingsError, ServerSettingsService> {
    const copilotSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.copilot),
    );
    const checkedAt = new Date().toISOString();
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      copilotSettings.customModels,
    );

    if (!copilotSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          authStatus: "unknown",
          message: "GitHub Copilot is disabled in T3 Code settings.",
        },
      });
    }

    const cliPath =
      normalizeCopilotCliPathOverride(copilotSettings.binaryPath) ?? resolveBundledCopilotCliPath();
    const probe = yield* Effect.tryPromise({
      try: async () => {
        const client = new CopilotClient({
          ...(cliPath ? { cliPath } : {}),
          logLevel: "error",
        });

        try {
          await client.start();
          const [status, authStatus] = await Promise.all([
            client.getStatus(),
            client.getAuthStatus().catch(() => undefined),
          ]);
          return { status, authStatus };
        } finally {
          await client.stop().catch(() => undefined);
        }
      },
      catch: toProbeError,
    }).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

    if (Result.isFailure(probe)) {
      const error = probe.failure.cause;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          authStatus: "unknown",
          message: isCommandMissingCause(error)
            ? "GitHub Copilot CLI is not installed or could not be resolved."
            : `Failed to start GitHub Copilot CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(probe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "error",
          authStatus: "unknown",
          message: "GitHub Copilot CLI health check timed out while starting the SDK client.",
        },
      });
    }

    const authStatus: ServerProviderAuthStatus =
      probe.success.value.authStatus?.isAuthenticated === true
        ? "authenticated"
        : probe.success.value.authStatus?.isAuthenticated === false
          ? "unauthenticated"
          : "unknown";
    const status: Exclude<ServerProviderState, "disabled"> =
      authStatus === "unauthenticated" ? "error" : authStatus === "unknown" ? "warning" : "ready";

    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: probe.success.value.status?.version ?? null,
        status,
        authStatus,
        ...(probe.success.value.authStatus?.statusMessage
          ? { message: probe.success.value.authStatus.statusMessage }
          : probe.success.value.status?.version
            ? { message: `GitHub Copilot CLI ${probe.success.value.status.version}` }
            : {}),
      },
    });
  },
);

export const CopilotProviderLive = Layer.effect(
  CopilotProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    const checkProvider = checkCopilotProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
    );

    return yield* makeManagedServerProvider<CopilotSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.copilot),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.copilot),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
