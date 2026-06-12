import {
  type KimiCodeSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  makeKimiCodeAcpRuntime,
  resolveKimiCodeAcpBaseModelId,
} from "../acp/KimiCodeAcpSupport.ts";

const KIMI_CODE_PRESENTATION = {
  displayName: "Kimi Code",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;
const PROVIDER = ProviderDriverKind.make("kimiCode");
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const KIMI_CODE_ACP_PROBE_TIMEOUT_MS = 15_000;

const KIMI_CODE_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "kimi-code/kimi-for-coding",
    name: "Kimi K2.7 Code",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

function kimiCodeModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = KIMI_CODE_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

function buildKimiCodeDiscoveredModelsFromSessionModelState(
  modelState: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!modelState || modelState.availableModels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return modelState.availableModels
    .map((model): ServerProviderModel | undefined => {
      const slug = resolveKimiCodeAcpBaseModelId(model.modelId);
      if (!slug || seen.has(slug)) {
        return undefined;
      }
      seen.add(slug);
      return {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

function isAcpAuthRequiredError(error: EffectAcpErrors.AcpError): boolean {
  if (error._tag === "AcpRequestError") {
    return (
      error.code === -32000 || /auth|login|unauthenticated|not logged in/i.test(error.errorMessage)
    );
  }
  return false;
}

const discoverKimiCodeModelsViaAcp = (
  kimiCodeSettings: KimiCodeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acp = yield* makeKimiCodeAcpRuntime({
      kimiCodeSettings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    return buildKimiCodeDiscoveredModelsFromSessionModelState(started.sessionSetupResult.models);
  }).pipe(Effect.scoped);

const runKimiCodeVersionCommand = (
  kimiCodeSettings: KimiCodeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const command = kimiCodeSettings.binaryPath || "kimi";
  return spawnAndCollect(
    command,
    ChildProcess.make(command, ["--version"], {
      env: environment,
      shell: process.platform === "win32",
    }),
  );
};

export function buildInitialKimiCodeProviderSnapshot(
  kimiCodeSettings: KimiCodeSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = kimiCodeModelsFromSettings(kimiCodeSettings.customModels);

    if (!kimiCodeSettings.enabled) {
      return buildServerProvider({
        presentation: KIMI_CODE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Kimi Code is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Kimi Code CLI availability...",
      },
    });
  });
}

export const checkKimiCodeProviderStatus = Effect.fn("checkKimiCodeProviderStatus")(function* (
  kimiCodeSettings: KimiCodeSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = kimiCodeModelsFromSettings(kimiCodeSettings.customModels);

  if (!kimiCodeSettings.enabled) {
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kimi Code is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* runKimiCodeVersionCommand(kimiCodeSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: kimiCodeSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Kimi Code CLI (`kimi`) is not installed or not on PATH."
          : `Failed to execute Kimi Code CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: kimiCodeSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kimi Code CLI is installed but timed out while running `kimi --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    const detail = detailFromResult(versionOutput);
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: kimiCodeSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Kimi Code CLI is installed but failed to run. ${detail}`
          : "Kimi Code CLI is installed but failed to run.",
      },
    });
  }

  const discoveryExit = yield* discoverKimiCodeModelsViaAcp(kimiCodeSettings, environment).pipe(
    Effect.timeoutOption(KIMI_CODE_ACP_PROBE_TIMEOUT_MS),
    Effect.exit,
  );

  if (Exit.isFailure(discoveryExit)) {
    const cause = discoveryExit.cause;
    const detail = Cause.pretty(cause);
    const failReason = cause.reasons.find(Cause.isFailReason);
    const error = failReason?.error;
    const isAuthError = error && isAcpAuthRequiredError(error);

    yield* Effect.logWarning("Kimi Code ACP probe failed", { cause: detail });
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: kimiCodeSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: isAuthError ? { status: "unauthenticated" } : { status: "unknown" },
        message: isAuthError
          ? "Kimi Code is not authenticated. Run `kimi login` and try again."
          : `Kimi Code CLI is installed but ACP startup failed. ${detail}`,
      },
    });
  }

  if (Option.isNone(discoveryExit.value)) {
    yield* Effect.logWarning(
      `Kimi Code ACP probe timed out after ${KIMI_CODE_ACP_PROBE_TIMEOUT_MS}ms.`,
    );
    return buildServerProvider({
      presentation: KIMI_CODE_PRESENTATION,
      enabled: kimiCodeSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Kimi Code CLI is installed but ACP startup timed out after ${KIMI_CODE_ACP_PROBE_TIMEOUT_MS}ms.`,
      },
    });
  }

  const discoveredModels = discoveryExit.value.value;
  const models =
    discoveredModels.length > 0
      ? kimiCodeModelsFromSettings(kimiCodeSettings.customModels, discoveredModels)
      : fallbackModels;

  return buildServerProvider({
    presentation: KIMI_CODE_PRESENTATION,
    enabled: kimiCodeSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});

export const enrichKimiCodeSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Kimi Code version advisory enrichment failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.asVoid,
  );
};
