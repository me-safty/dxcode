import {
  type DroidSettings,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("droid");
const DROID_PRESENTATION = {
  displayName: "Droid",
  badgeLabel: "WIP",
  showInteractionModeToggle: true,
} as const;

const DROID_MODEL_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "reasoningEffort",
      label: "Reasoning",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
    }),
  ],
});

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "default",
    name: "Factory default",
    shortName: "Default",
    isCustom: false,
    capabilities: DROID_MODEL_CAPABILITIES,
  },
];

export function makePendingDroidProvider(
  settings: DroidSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      settings.customModels,
      DROID_MODEL_CAPABILITIES,
    );

    return buildServerProvider({
      presentation: DROID_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models,
      probe: {
        installed: settings.enabled,
        version: null,
        status: settings.enabled ? "warning" : "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Droid availability..."
          : "Droid is disabled in T3 Code settings.",
      },
    });
  });
}

export function checkDroidProviderStatus(
  settings: DroidSettings,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      settings.customModels,
      DROID_MODEL_CAPABILITIES,
    );

    if (!settings.enabled) {
      return yield* makePendingDroidProvider(settings);
    }

    const command = ChildProcess.make(settings.binaryPath, ["--version"], {
      env: environment,
      shell: process.platform === "win32",
    });
    const result = yield* spawnAndCollect(settings.binaryPath, command).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(result)) {
      const cause = result.failure;
      const message = cause instanceof Error ? cause.message : String(cause);
      return buildServerProvider({
        presentation: DROID_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause({ message }),
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: isCommandMissingCause({ message })
            ? "Droid CLI (`droid`) is not installed or not on PATH."
            : `Failed to execute Droid CLI health check: ${message}.`,
        },
      });
    }

    if (Option.isNone(result.success)) {
      return buildServerProvider({
        presentation: DROID_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Timed out while checking Droid CLI availability.",
        },
      });
    }

    const commandResult = result.success.value;
    const detail = detailFromResult(commandResult);
    const missing = detail ? isCommandMissingCause({ message: detail }) : false;
    return buildServerProvider({
      presentation: DROID_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: commandResult.code === 0 || !missing,
        version: parseGenericCliVersion(commandResult.stdout || commandResult.stderr),
        status: commandResult.code === 0 ? "ready" : "warning",
        auth: { status: commandResult.code === 0 ? "unknown" : "unauthenticated" },
        ...(commandResult.code === 0
          ? {}
          : {
              message: missing
                ? "Droid CLI (`droid`) is not installed or not on PATH."
                : (detail ?? "Failed to check Droid CLI availability."),
            }),
      },
    });
  });
}
