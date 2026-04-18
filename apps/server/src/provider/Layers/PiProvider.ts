import type { PiSettings, ServerProvider } from "@t3tools/contracts";
import { Cause, Effect, Equal, Layer, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
} from "../providerSnapshot.ts";
import { PiProvider } from "../Services/PiProvider.ts";
import {
  compareVersions,
  DEFAULT_PI_BUILTIN_MODELS,
  DEFAULT_PI_MODEL_CAPABILITIES,
  detectPiAuth,
  PI_BACKEND_OPTIONS,
  PI_MIN_RECOMMENDED_VERSION,
  runPiCommand,
} from "../piRuntime.ts";

const PROVIDER = "pi" as const;

class PiProbePromiseError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = cause;
    this.name = "PiProbePromiseError";
  }
}

function toPiProbeError(cause: unknown): PiProbePromiseError {
  return new PiProbePromiseError(cause);
}

function formatPiProbeError(cause: unknown): {
  readonly installed: boolean;
  readonly message: string;
} {
  if (cause instanceof Error && isCommandMissingCause(cause)) {
    return {
      installed: false,
      message:
        "pi CLI (`pi`) is not installed or not on PATH. Install with `npm install -g @mariozechner/pi-coding-agent` or `brew install pi`.",
    };
  }
  const detail = cause instanceof Error ? cause.message.trim() : "";
  return {
    installed: true,
    message: detail.length > 0 ? `Failed to probe pi: ${detail}` : "Failed to probe pi.",
  };
}

function buildSetupMessage(backendLabel: string, envVars: ReadonlyArray<string>): string {
  const joined = envVars.join(" or ");
  return `pi is installed. Export ${joined} to use ${backendLabel}, or pick a different backend in settings.`;
}

function buildNoBackendConfiguredMessage(): string {
  const options = PI_BACKEND_OPTIONS.map((option) => option.label).join(", ");
  return `pi is installed but no backend is configured. Choose one in settings (${options}) and export the matching key.`;
}

const makePendingPiProvider = (piSettings: PiSettings): ServerProvider => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    DEFAULT_PI_BUILTIN_MODELS,
    PROVIDER,
    piSettings.customModels,
    DEFAULT_PI_MODEL_CAPABILITIES,
  );

  if (!piSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "pi is disabled in settings.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "pi provider status has not been checked in this session yet.",
    },
  });
};

export function checkPiProviderStatus(input: {
  readonly settings: PiSettings;
}): Effect.Effect<ServerProvider> {
  const checkedAt = new Date().toISOString();
  const customModels = input.settings.customModels;

  const fallback = (cause: unknown, version: string | null = null) => {
    const failure = formatPiProbeError(cause);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: input.settings.enabled,
      checkedAt,
      models: providerModelsFromSettings(
        failure.installed ? DEFAULT_PI_BUILTIN_MODELS : [],
        PROVIDER,
        customModels,
        DEFAULT_PI_MODEL_CAPABILITIES,
      ),
      probe: {
        installed: failure.installed,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: failure.message,
      },
    });
  };

  return Effect.gen(function* () {
    if (!input.settings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models: providerModelsFromSettings(
          [],
          PROVIDER,
          customModels,
          DEFAULT_PI_MODEL_CAPABILITIES,
        ),
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "pi is disabled in settings.",
        },
      });
    }

    const binaryPath =
      input.settings.binaryPath.trim().length > 0 ? input.settings.binaryPath : "pi";
    const versionExit = yield* Effect.exit(
      Effect.tryPromise({
        try: () =>
          runPiCommand({
            binaryPath,
            args: ["--version"],
          }),
        catch: toPiProbeError,
      }),
    );
    if (versionExit._tag === "Failure") {
      return fallback(Cause.squash(versionExit.cause));
    }
    // pi prints its version to stderr, not stdout — check both.
    const version =
      parseGenericCliVersion(versionExit.value.stdout) ??
      parseGenericCliVersion(versionExit.value.stderr) ??
      null;

    const auth = detectPiAuth({
      defaultProvider: input.settings.defaultProvider,
      env: process.env,
    });

    const models = providerModelsFromSettings(
      DEFAULT_PI_BUILTIN_MODELS,
      PROVIDER,
      customModels,
      DEFAULT_PI_MODEL_CAPABILITIES,
    );

    const versionTooOld =
      version !== null && compareVersions(version, PI_MIN_RECOMMENDED_VERSION) < 0;

    if (!auth.authenticated) {
      const message = auth.checkedBackend
        ? buildSetupMessage(auth.checkedBackend.label, auth.checkedBackend.envVars)
        : buildNoBackendConfiguredMessage();
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version,
          status: "warning",
          auth: { status: "unauthenticated" },
          message,
        },
      });
    }

    const backendLabel = auth.checkedBackend?.label ?? "pi backend";
    const via = auth.detectedEnvVar ? ` via ${auth.detectedEnvVar}` : "";
    const versionSuffix = versionTooOld
      ? ` Note: pi ${version ?? "(unknown)"} is older than the recommended ${PI_MIN_RECOMMENDED_VERSION}.`
      : "";
    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: versionTooOld ? "warning" : "ready",
        auth: {
          status: "authenticated",
          type: "pi",
        },
        message: `pi is ready using ${backendLabel}${via}.${versionSuffix}`,
      },
    });
  });
}

export function makePiProviderLive() {
  return Layer.effect(
    PiProvider,
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const getProviderSettings = serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.pi),
      );

      return yield* makeManagedServerProvider<PiSettings>({
        getSettings: getProviderSettings.pipe(Effect.orDie),
        streamSettings: serverSettings.streamChanges.pipe(
          Stream.map((settings) => settings.providers.pi),
        ),
        haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
        initialSnapshot: makePendingPiProvider,
        checkProvider: getProviderSettings.pipe(
          Effect.flatMap((settings) => checkPiProviderStatus({ settings })),
        ),
      });
    }),
  );
}

export const PiProviderLive = makePiProviderLive();
