import {
  type ModelCapabilities,
  type PiSettings,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { expandHomePath } from "../../pathExpansion.ts";
import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Experimental",
  showInteractionModeToggle: true,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

class PiProviderProbeError extends Data.TaggedError("PiProviderProbeError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function slugForPiModel(model: { readonly provider: string; readonly id: string }): string {
  return `${model.provider}/${model.id}`;
}

function nameForPiModel(model: { readonly provider: string; readonly name: string }): string {
  return `${model.name} (${model.provider})`;
}

function piModelCapabilities(model: { readonly reasoning?: boolean }): ModelCapabilities {
  if (!model.reasoning) return EMPTY_CAPABILITIES;
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "thinkingLevel",
        label: "Thinking",
        type: "select",
        options: [
          { id: "off", label: "Off" },
          { id: "minimal", label: "Minimal" },
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
          { id: "high", label: "High" },
          { id: "xhigh", label: "XHigh" },
        ],
        currentValue: "medium",
      },
    ],
  });
}

function getAgentDir(settings: Pick<PiSettings, "agentDir">): string | undefined {
  const trimmed = settings.agentDir.trim();
  return trimmed.length > 0 ? expandHomePath(trimmed) : undefined;
}

async function loadPiModels(settings: PiSettings): Promise<ReadonlyArray<ServerProviderModel>> {
  const pi = await import("@earendil-works/pi-coding-agent");
  const agentDir = getAgentDir(settings);
  const authStorage = pi.AuthStorage.create(agentDir ? `${agentDir}/auth.json` : undefined);
  const modelRegistry = pi.ModelRegistry.create(
    authStorage,
    agentDir ? `${agentDir}/models.json` : undefined,
  );

  const builtIn = modelRegistry.getAvailable().map((model) => ({
    slug: slugForPiModel(model),
    name: nameForPiModel(model),
    shortName: model.name,
    subProvider: modelRegistry.getProviderDisplayName(model.provider),
    isCustom: false,
    capabilities: piModelCapabilities(model),
  }));

  return providerModelsFromSettings(builtIn, PROVIDER, settings.customModels, EMPTY_CAPABILITIES);
}

export const makePendingPiProvider = (piSettings: PiSettings): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: providerModelsFromSettings([], PROVIDER, piSettings.customModels, EMPTY_CAPABILITIES),
      probe: {
        installed: true,
        version: null,
        status: piSettings.enabled ? "warning" : "warning",
        auth: { status: "unknown" },
        message: piSettings.enabled
          ? "Checking Pi SDK availability..."
          : "Pi is disabled in T3 Code settings.",
      },
    });
  });

export function checkPiProviderStatus(piSettings: PiSettings): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);

    if (!piSettings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models: providerModelsFromSettings(
          [],
          PROVIDER,
          piSettings.customModels,
          EMPTY_CAPABILITIES,
        ),
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in T3 Code settings.",
        },
      });
    }

    const probe = yield* Effect.tryPromise({
      try: async () => {
        const pi = await import("@earendil-works/pi-coding-agent");
        const models = await loadPiModels(piSettings);
        const agentDir = getAgentDir(piSettings);
        const authStorage = pi.AuthStorage.create(agentDir ? `${agentDir}/auth.json` : undefined);
        const modelRegistry = pi.ModelRegistry.create(
          authStorage,
          agentDir ? `${agentDir}/models.json` : undefined,
        );
        return {
          version: pi.VERSION,
          models,
          hasAuth: modelRegistry.getAvailable().length > 0,
        };
      },
      catch: (cause) =>
        new PiProviderProbeError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(Effect.result);

    if (probe._tag === "Failure") {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: true,
        checkedAt,
        models: providerModelsFromSettings(
          [],
          PROVIDER,
          piSettings.customModels,
          EMPTY_CAPABILITIES,
        ),
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `Failed to load Pi SDK: ${probe.failure.message}`,
        },
      });
    }

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: probe.success.models,
      probe: {
        installed: true,
        version: probe.success.version,
        status: probe.success.hasAuth ? "ready" : "warning",
        auth: { status: probe.success.hasAuth ? "authenticated" : "unknown" },
        ...(probe.success.hasAuth
          ? {}
          : { message: "No Pi provider credentials found in auth.json or environment." }),
      },
    });
  });
}
