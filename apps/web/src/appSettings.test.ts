import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  DEFAULT_TIMESTAMP_FORMAT,
  getAppModelOptions,
  normalizeCustomModelSlugs,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("notification setting defaults", () => {
  it("defaults notification settings to disabled", () => {
    expect(DEFAULT_APP_SETTINGS.enableSystemNotifications).toBe(false);
    expect(DEFAULT_APP_SETTINGS.enableCompletionSound).toBe(false);
    expect(DEFAULT_APP_SETTINGS.notificationSoundSelection).toBe("default");
    expect(DEFAULT_APP_SETTINGS.notificationCustomSoundName).toBe("");
    expect(DEFAULT_APP_SETTINGS.notificationCustomSoundId).toBe("");
  });

  it("hydrates older settings payloads with notification defaults", () => {
    const decoded = Schema.decodeUnknownSync(AppSettingsSchema)({
      codexBinaryPath: "",
      codexHomePath: "",
      defaultThreadEnvMode: "local",
      confirmThreadDelete: true,
      enableAssistantStreaming: false,
      timestampFormat: "locale",
      customCodexModels: [],
    });

    expect(decoded.enableSystemNotifications).toBe(false);
    expect(decoded.enableCompletionSound).toBe(false);
    expect(decoded.notificationSoundSelection).toBe("default");
    expect(decoded.notificationCustomSoundName).toBe("");
    expect(decoded.notificationCustomSoundId).toBe("");
  });
});
