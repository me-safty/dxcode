import type {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import * as Duration from "effect/Duration";

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

export function buildRestoreDefaultsPatch(input: {
  readonly settings: UnifiedSettings;
  readonly isGitWritingModelDirty: boolean;
}): Partial<UnifiedSettings> {
  return {
    ...(input.settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? { timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat }
      : {}),
    ...(input.settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
      ? { diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap }
      : {}),
    ...(input.settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? { diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace }
      : {}),
    ...(input.settings.sidebarThreadPreviewCount !==
    DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
      ? { sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount }
      : {}),
    ...(input.settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar
      ? { autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar }
      : {}),
    ...(input.settings.enableAssistantStreaming !==
    DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
      ? { enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming }
      : {}),
    ...(input.settings.telemetryEnabled !== DEFAULT_UNIFIED_SETTINGS.telemetryEnabled
      ? { telemetryEnabled: DEFAULT_UNIFIED_SETTINGS.telemetryEnabled }
      : {}),
    ...(input.settings.telemetryPreferenceSet !== DEFAULT_UNIFIED_SETTINGS.telemetryPreferenceSet
      ? { telemetryPreferenceSet: DEFAULT_UNIFIED_SETTINGS.telemetryPreferenceSet }
      : {}),
    ...(Duration.toMillis(input.settings.automaticGitFetchInterval) !==
    Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval)
      ? { automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval }
      : {}),
    ...(input.settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? { defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode }
      : {}),
    ...(input.settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? { newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin }
      : {}),
    ...(input.settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? { addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory }
      : {}),
    ...(input.settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? { confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive }
      : {}),
    ...(input.settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? { confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete }
      : {}),
    ...(input.isGitWritingModelDirty
      ? { textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection }
      : {}),
  };
}
