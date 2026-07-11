import {
  ProviderDriverKind,
  type KiloSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type { ProviderListResponse } from "@kilocode/sdk/v2";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { KiloRuntime, kiloRuntimeErrorDetail } from "../kiloRuntime.ts";

const PROVIDER = ProviderDriverKind.make("kilo");
const PRESENTATION = { displayName: "Kilo", showInteractionModeToggle: true } as const;
const DEFAULT_CAPABILITIES: ModelCapabilities = { optionDescriptors: [] };

export function flattenKiloModels(
  inventory: ProviderListResponse,
): ReadonlyArray<ServerProviderModel> {
  const connected = new Set(inventory.connected);
  const models: Array<ServerProviderModel> = [];
  for (const provider of inventory.all) {
    if (!connected.has(provider.id)) continue;
    for (const model of Object.values(provider.models)) {
      const name = nonEmptyTrimmed(model.name);
      if (!name) continue;
      const subProvider = nonEmptyTrimmed(provider.name);
      models.push({
        slug: `${provider.id}/${model.id}`,
        name,
        ...(subProvider ? { subProvider } : {}),
        isCustom: false,
        capabilities: DEFAULT_CAPABILITIES,
      });
    }
  }
  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

function modelsFromSettings(settings: KiloSettings, live: ReadonlyArray<ServerProviderModel> = []) {
  return providerModelsFromSettings(live, PROVIDER, settings.customModels, DEFAULT_CAPABILITIES);
}

export const makePendingKiloProvider = (
  settings: KiloSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(settings),
      probe: settings.enabled
        ? {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Kilo provider status has not been checked in this session yet.",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Kilo is disabled in T3 Code settings.",
          },
    });
  });

export const checkKiloProviderStatus = Effect.fn("checkKiloProviderStatus")(function* (
  settings: KiloSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, KiloRuntime> {
  const runtime = yield* KiloRuntime;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallback = (cause: unknown, version: string | null = null) => {
    const detail = kiloRuntimeErrorDetail(cause);
    const missing = detail.toLowerCase().includes("enoent");
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(settings),
      probe: {
        installed: !missing,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: missing
          ? "Kilo CLI (`kilo`) is not installed or not on PATH."
          : `Failed to initialize Kilo: ${detail}`,
      },
    });
  };

  if (!settings.enabled) return yield* makePendingKiloProvider(settings);

  const versionExit = yield* Effect.exit(
    runtime.runCommand({
      binaryPath: settings.binaryPath,
      args: ["--version"],
      ...(environment ? { environment } : {}),
    }),
  );
  if (versionExit._tag === "Failure") return fallback(Cause.squash(versionExit.cause));
  const version = parseGenericCliVersion(versionExit.value.stdout) ?? null;

  const inventoryExit = yield* Effect.exit(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* runtime.startServer({
          binaryPath: settings.binaryPath,
          ...(environment ? { environment } : {}),
        });
        return yield* runtime.loadInventory(
          runtime.createClient({ baseUrl: server.url, directory: cwd }),
        );
      }),
    ),
  );
  if (inventoryExit._tag === "Failure") return fallback(Cause.squash(inventoryExit.cause), version);

  const connectedCount = inventoryExit.value.connected.length;
  return buildServerProvider({
    presentation: PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(settings, flattenKiloModels(inventoryExit.value)),
    probe: {
      installed: true,
      version,
      status: connectedCount > 0 ? "ready" : "warning",
      auth: {
        status: connectedCount > 0 ? "authenticated" : "unknown",
        type: "kilo",
      },
      message:
        connectedCount > 0
          ? `${connectedCount} upstream provider${connectedCount === 1 ? "" : "s"} connected through Kilo.`
          : "Kilo is available, but it did not report any connected upstream providers.",
    },
  });
});
