import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "./model.ts";
import {
  applyServerSettingsPatch,
  extractPersistedServerObservabilitySettings,
  normalizePersistedServerSettingString,
  normalizeDecodedPersistedServerSettings,
  parsePersistedServerObservabilitySettings,
} from "./serverSettings.ts";

describe("serverSettings helpers", () => {
  it("normalizes optional persisted strings", () => {
    expect(normalizePersistedServerSettingString(undefined)).toBeUndefined();
    expect(normalizePersistedServerSettingString("   ")).toBeUndefined();
    expect(normalizePersistedServerSettingString("  http://localhost:4318/v1/traces  ")).toBe(
      "http://localhost:4318/v1/traces",
    );
  });

  it("extracts persisted observability settings", () => {
    expect(
      extractPersistedServerObservabilitySettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      }),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
    });
  });

  it("parses lenient persisted settings JSON", () => {
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
            otlpMetricsUrl: "http://localhost:4318/v1/metrics",
          },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
    });
  });

  it("falls back cleanly when persisted settings are invalid", () => {
    expect(parsePersistedServerObservabilitySettings("{")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
    });
  });

  it("replaces text generation selection when provider/model are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("still deep merges text generation selection when only options are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: false },
      ],
    });
  });

  it("replaces text generation selection across providers without leaking stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });

  it("accepts array-based text generation selection patches", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
          options: [
            { id: "variant", value: "prod" },
            { id: "agent", value: "build" },
          ],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
      options: [
        { id: "variant", value: "prod" },
        { id: "agent", value: "build" },
      ],
    });
  });

  it("marks telemetry preference set when telemetry is patched", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        telemetryEnabled: false,
      }),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: true,
    });

    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        telemetryEnabled: true,
        telemetryPreferenceSet: false,
      }),
    ).toMatchObject({
      telemetryEnabled: true,
      telemetryPreferenceSet: true,
    });
  });

  it("keeps telemetry preference sticky when the patch omits the marker", () => {
    expect(
      applyServerSettingsPatch(
        {
          ...DEFAULT_SERVER_SETTINGS,
          telemetryEnabled: false,
          telemetryPreferenceSet: true,
        },
        {
          enableAssistantStreaming: true,
        },
      ),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: true,
    });
  });

  it("clears telemetry preference when the patch explicitly resets the marker", () => {
    expect(
      applyServerSettingsPatch(
        {
          ...DEFAULT_SERVER_SETTINGS,
          telemetryEnabled: false,
          telemetryPreferenceSet: true,
        },
        {
          telemetryPreferenceSet: false,
        },
      ),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: false,
    });
  });

  it("clears telemetry preference when restore defaults resets telemetry", () => {
    expect(
      applyServerSettingsPatch(
        {
          ...DEFAULT_SERVER_SETTINGS,
          telemetryEnabled: false,
          telemetryPreferenceSet: true,
        },
        {
          telemetryEnabled: false,
          telemetryPreferenceSet: false,
        },
      ),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: false,
    });
  });

  it("treats persisted telemetryEnabled as an explicit preference", () => {
    expect(
      normalizeDecodedPersistedServerSettings(
        { ...DEFAULT_SERVER_SETTINGS, telemetryEnabled: false, telemetryPreferenceSet: false },
        '{ "telemetryEnabled": false }',
      ),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: true,
    });

    expect(
      normalizeDecodedPersistedServerSettings(
        { ...DEFAULT_SERVER_SETTINGS, telemetryEnabled: false, telemetryPreferenceSet: false },
        '{ "telemetryEnabled": true }',
      ),
    ).toMatchObject({
      telemetryEnabled: true,
      telemetryPreferenceSet: true,
    });
  });

  it("treats malformed persisted telemetryEnabled as an explicit preference", () => {
    expect(
      normalizeDecodedPersistedServerSettings(
        { ...DEFAULT_SERVER_SETTINGS, telemetryEnabled: false, telemetryPreferenceSet: false },
        '{ "telemetryEnabled": "false" }',
      ),
    ).toMatchObject({
      telemetryEnabled: false,
      telemetryPreferenceSet: true,
    });
  });

  it("replaces providerInstances maps so omitted instance fields are cleared", () => {
    const codexId = ProviderInstanceId.make("codex");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          displayName: "Codex Work",
          accentColor: "#7c3aed",
          enabled: true,
          config: { homePath: "~/.codex" },
        },
      },
    };

    expect(
      applyServerSettingsPatch(current, {
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      }).providerInstances[codexId],
    ).toEqual({
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex Work",
      enabled: true,
      config: { homePath: "~/.codex" },
    });
  });
});
