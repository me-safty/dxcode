import type {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerProvider,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";
import { defaultInstanceIdForDriver } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

function collapseOtelSignalsUrl(input: {
  readonly tracesUrl: string;
  readonly metricsUrl: string;
}): string | null {
  const tracesSuffix = "/traces";
  const metricsSuffix = "/metrics";
  if (!input.tracesUrl.endsWith(tracesSuffix) || !input.metricsUrl.endsWith(metricsSuffix)) {
    return null;
  }

  const tracesBase = input.tracesUrl.slice(0, -tracesSuffix.length);
  const metricsBase = input.metricsUrl.slice(0, -metricsSuffix.length);
  if (tracesBase !== metricsBase) {
    return null;
  }

  return `${tracesBase}/{traces,metrics}`;
}

export function formatDiagnosticsDescription(input: {
  readonly localTracingEnabled: boolean;
  readonly otlpTracesEnabled: boolean;
  readonly otlpTracesUrl?: string | undefined;
  readonly otlpMetricsEnabled: boolean;
  readonly otlpMetricsUrl?: string | undefined;
}): string {
  const mode = input.localTracingEnabled ? "Local trace file" : "Terminal logs only";
  const tracesUrl = input.otlpTracesEnabled ? input.otlpTracesUrl : undefined;
  const metricsUrl = input.otlpMetricsEnabled ? input.otlpMetricsUrl : undefined;

  if (tracesUrl && metricsUrl) {
    const collapsedUrl = collapseOtelSignalsUrl({ tracesUrl, metricsUrl });
    return collapsedUrl
      ? `${mode}. Exporting OTEL to ${collapsedUrl}.`
      : `${mode}. Exporting OTEL traces to ${tracesUrl} and metrics to ${metricsUrl}.`;
  }

  if (tracesUrl) {
    return `${mode}. Exporting OTEL traces to ${tracesUrl}.`;
  }

  if (metricsUrl) {
    return `${mode}. Exporting OTEL metrics to ${metricsUrl}.`;
  }

  return `${mode}.`;
}

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];
  const legacyProviderDefaults = DEFAULT_UNIFIED_SETTINGS.providers as Record<
    string,
    LegacyProviderSettings | undefined
  >;
  const legacyProviderDefault = input.isDefault ? legacyProviderDefaults[input.driver] : undefined;
  return {
    ...(legacyProviderDefault !== undefined
      ? {
          providers: {
            ...input.settings.providers,
            [input.driver]: legacyProviderDefault,
          } as ServerSettings["providers"],
        }
      : {}),
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

export interface ProviderProfileRow {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly isDefault: boolean;
}

export interface ProviderProfileGroup {
  readonly driver: ProviderDriverKind;
  readonly rows: ReadonlyArray<ProviderProfileRow>;
}

export function nextProviderProfileId(
  providerInstances: Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>,
  driver: ProviderDriverKind,
): ProviderInstanceId {
  let index = 1;
  while (providerInstances[ProviderInstanceId.make(`${driver}_profile_${index}`)] !== undefined) {
    index++;
  }
  return ProviderInstanceId.make(`${driver}_profile_${index}`);
}

export function buildProviderProfileGroups(input: {
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly drivers: ReadonlyArray<ProviderDriverKind>;
}): ReadonlyArray<ProviderProfileGroup> {
  type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];
  const legacyProviders = input.settings.providers as Record<string, LegacyProviderSettings>;

  return input.drivers
    .filter((driver) => {
      const defaultId = defaultInstanceIdForDriver(driver);
      return (
        (input.settings.providerInstances[defaultId]?.enabled ??
          legacyProviders[driver]?.enabled ??
          false) &&
        (input.serverProviders.find((provider) => provider.instanceId === defaultId)?.enabled ??
          true)
      );
    })
    .map((driver) => {
      const defaultId = defaultInstanceIdForDriver(driver);
      const defaultConfig = legacyProviders[driver]!;
      const defaultInstance =
        input.settings.providerInstances[defaultId] ??
        ({
          driver,
          enabled: defaultConfig.enabled,
          config: defaultConfig,
        } satisfies ProviderInstanceConfig);

      const rows: ProviderProfileRow[] = [
        { instanceId: defaultId, instance: defaultInstance, isDefault: true },
        ...Object.entries(input.settings.providerInstances)
          .filter(
            ([id, instance]) =>
              id !== defaultId && instance.driver === driver && (instance.enabled ?? true),
          )
          .map(([instanceId, instance]) => ({
            instanceId: instanceId as ProviderInstanceId,
            instance,
            isDefault: false,
          })),
      ];

      return { driver, rows };
    });
}
