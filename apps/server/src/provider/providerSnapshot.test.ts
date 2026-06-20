import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ModelCapabilities } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  isCommandMissingCause,
  ProviderCommandNotFoundError,
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

describe("ProviderCommandNotFoundError", () => {
  it("retains the failed command result as structured diagnostics", () => {
    const error = new ProviderCommandNotFoundError({
      binaryPath: "C:\\tools\\codex.cmd",
      exitCode: 9009,
      stdout: "",
      stderr: "'codex' is not recognized as an internal or external command",
    });

    expect(error.binaryPath).toBe("C:\\tools\\codex.cmd");
    expect(error.exitCode).toBe(9009);
    expect(error.stderr).toContain("not recognized");
    expect(error.message).toBe(
      "Provider command C:\\tools\\codex.cmd was not found (exit code 9009).",
    );
    expect(isCommandMissingCause(error)).toBe(true);
  });
});
