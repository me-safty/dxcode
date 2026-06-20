import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ModelCapabilities } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  applyProviderAdapterCapabilities,
  buildServerProvider,
  providerModelsFromSettings,
} from "./providerSnapshot.ts";

const OPENCODE_CUSTOM_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [{ id: "build", label: "Build", isDefault: true }],
      currentValue: "build",
    },
  ],
});

describe("providerModelsFromSettings", () => {
  it("applies the provided capabilities to custom models", () => {
    const models = providerModelsFromSettings(
      [],
      ProviderDriverKind.make("opencode"),
      ["openai/gpt-5"],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "openai/gpt-5",
        name: "openai/gpt-5",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
    ]);
  });
});

describe("applyProviderAdapterCapabilities", () => {
  const snapshot = buildServerProvider({
    presentation: { displayName: "Test Provider" },
    enabled: true,
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
    probe: {
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
    },
  });

  it("derives the UI model-change flag from the adapter capability", () => {
    expect(
      applyProviderAdapterCapabilities(snapshot, { sessionModelSwitch: "new-thread" })
        .requiresNewThreadForModelChange,
    ).toBe(true);
    expect(
      applyProviderAdapterCapabilities(snapshot, { sessionModelSwitch: "in-session" })
        .requiresNewThreadForModelChange,
    ).toBeUndefined();
  });
});
