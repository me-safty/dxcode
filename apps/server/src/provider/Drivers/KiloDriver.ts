import { KiloSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import { makeKiloTextGeneration } from "../../textGeneration/KiloTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeKiloAdapter } from "../Layers/KiloAdapter.ts";
import { checkKiloProviderStatus, makePendingKiloProvider } from "../Layers/KiloProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { KiloRuntime } from "../kiloRuntime.ts";

const DRIVER_KIND = ProviderDriverKind.make("kilo");
const REFRESH_INTERVAL = Duration.minutes(5);
const decodeSettings = Schema.decodeSync(KiloSettings);

export type KiloDriverEnv =
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | KiloRuntime
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

const withIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationKey },
  });

export const KiloDriver: ProviderDriver<KiloSettings, KiloDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Kilo", supportsMultipleInstances: true },
  configSchema: KiloSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const runtime = yield* KiloRuntime;
      const serverConfig = yield* ServerConfig;
      const settingsService = yield* ServerSettingsService;
      const processEnvironment = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled } satisfies KiloSettings;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stamp = withIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationKey: continuationIdentity.continuationKey,
      });
      const adapter = yield* makeKiloAdapter(effectiveConfig, {
        instanceId,
        environment: processEnvironment,
      });
      const textGeneration = yield* makeKiloTextGeneration(effectiveConfig, processEnvironment);
      const checkProvider = checkKiloProviderStatus(
        effectiveConfig,
        serverConfig.cwd,
        processEnvironment,
      ).pipe(Effect.map(stamp), Effect.provideService(KiloRuntime, runtime));
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, settingsService);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<KiloSettings>>({
        maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
          provider: DRIVER_KIND,
          packageName: "@kilocode/cli",
        }),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingKiloProvider(settings.provider).pipe(Effect.map(stamp)),
        checkProvider,
        refreshInterval: REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Kilo snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
