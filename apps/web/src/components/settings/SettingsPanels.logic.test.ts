import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  archivedThreadSelectionKey,
  buildArchivedThreadSelectionKeys,
  buildProviderInstanceUpdatePatch,
  pruneArchivedThreadSelection,
  formatDiagnosticsDescription,
} from "./SettingsPanels.logic";

describe("formatDiagnosticsDescription", () => {
  it("collapses trace and metric URLs that share the same OTEL base path", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      }),
    ).toBe("Local trace file. Exporting OTEL to http://localhost:4318/v1/{traces,metrics}.");
  });

  it("keeps separate trace and metric URLs when their base paths differ", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:9000/v1/metrics",
      }),
    ).toBe(
      "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces and metrics to http://localhost:9000/v1/metrics.",
    );
  });

  it("omits OTEL text when no exporter is enabled", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      }),
    ).toBe("Local trace file.");
  });
});

describe("buildProviderInstanceUpdatePatch", () => {
  it("promotes an edited default provider into providerInstances and resets the legacy provider", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        binaryPath: "/opt/t3/codex",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/legacy/codex",
          },
        },
      },
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: true,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers?.codex).toEqual(DEFAULT_SERVER_SETTINGS.providers.codex);
  });

  it("updates custom instances without touching legacy provider settings", () => {
    const instanceId = ProviderInstanceId.make("codex_personal");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        homePath: "/Users/example/.codex-personal",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: DEFAULT_SERVER_SETTINGS,
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: false,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers).toBeUndefined();
  });
});

describe("archived thread selection helpers", () => {
  it("scopes selection keys by environment and thread", () => {
    const threadId = ThreadId.make("thread-1");

    expect(
      archivedThreadSelectionKey({
        environmentId: EnvironmentId.make("environment-a"),
        threadId,
      }),
    ).toBe("environment-a:thread-1");
    expect(
      archivedThreadSelectionKey({
        environmentId: EnvironmentId.make("environment-b"),
        threadId,
      }),
    ).toBe("environment-b:thread-1");
  });

  it("keeps duplicate thread ids distinct across environments", () => {
    const threadId = ThreadId.make("thread-1");
    const selected = new Set([
      archivedThreadSelectionKey({
        environmentId: EnvironmentId.make("environment-a"),
        threadId,
      }),
      archivedThreadSelectionKey({
        environmentId: EnvironmentId.make("environment-b"),
        threadId,
      }),
    ]);

    expect(selected.size).toBe(2);
  });

  it("builds select-all keys from scoped archived threads", () => {
    expect(
      buildArchivedThreadSelectionKeys([
        {
          environmentId: EnvironmentId.make("environment-a"),
          threadId: ThreadId.make("thread-1"),
        },
        {
          environmentId: EnvironmentId.make("environment-b"),
          threadId: ThreadId.make("thread-1"),
        },
      ]),
    ).toEqual(["environment-a:thread-1", "environment-b:thread-1"]);
  });

  it("prunes selections that are no longer present in archived snapshots", () => {
    const selected = new Set(["environment-a:thread-1", "environment-a:thread-2"]);
    const available = new Set(["environment-a:thread-2", "environment-b:thread-1"]);

    expect([...pruneArchivedThreadSelection(selected, available)]).toEqual([
      "environment-a:thread-2",
    ]);
  });
});
