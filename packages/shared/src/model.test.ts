import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  getDefaultContextWindow,
  getDefaultEffort,
  hasContextWindowOption,
  hasEffortLevel,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
  resolveApiModelId,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
} from "./model";

const codexCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const claudeCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [
    { value: "200k", label: "200k" },
    { value: "1m", label: "1M", isDefault: true },
  ],
  promptInjectedEffortLevels: ["ultrathink"],
};

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("sonnet", "claudeAgent")).toBe("claude-sonnet-4-6");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "codex")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);

    expect(resolveModelSlugForProvider("claudeAgent", undefined)).toBe(
      DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    );
  });

  it("preserves normalized unknown models", () => {
    expect(resolveModelSlug("custom/internal-model", "codex")).toBe("custom/internal-model");
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ];
    expect(resolveSelectableModel("codex", "gpt-5.3-codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("codex", "gpt-5.3 codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("claudeAgent", "sonnet", options)).toBe("claude-sonnet-4-6");
  });
});

describe("capability helpers", () => {
  it("reads default efforts", () => {
    expect(getDefaultEffort(codexCaps)).toBe("high");
    expect(getDefaultEffort(claudeCaps)).toBe("high");
  });

  it("checks effort support", () => {
    expect(hasEffortLevel(codexCaps, "xhigh")).toBe(true);
    expect(hasEffortLevel(codexCaps, "max")).toBe(false);
  });
});

describe("misc helpers", () => {
  it("detects ultrathink prompts", () => {
    expect(isClaudeUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(isClaudeUltrathinkPrompt("Investigate")).toBe(false);
  });

  it("prefixes ultrathink prompts once", () => {
    expect(applyClaudePromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(applyClaudePromptEffortPrefix("Ultrathink:\nInvestigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
  });

  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("context window helpers", () => {
  it("reads default context window", () => {
    expect(getDefaultContextWindow(claudeCaps)).toBe("1m");
  });

  it("returns null for models without context window options", () => {
    expect(getDefaultContextWindow(codexCaps)).toBeNull();
  });

  it("checks context window support", () => {
    expect(hasContextWindowOption(claudeCaps, "1m")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "200k")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "bogus")).toBe(false);
    expect(hasContextWindowOption(codexCaps, "1m")).toBe(false);
  });
});

describe("resolveApiModelId", () => {
  it("appends [1m] suffix for explicit 1m context window", () => {
    expect(
      resolveApiModelId(
        { provider: "claudeAgent", model: "claude-opus-4-6", options: { contextWindow: "1m" } },
        claudeCaps,
      ),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("applies default context window suffix when contextWindow is not set", () => {
    // 1m is the default for claudeCaps, so [1m] suffix should be applied
    expect(
      resolveApiModelId({ provider: "claudeAgent", model: "claude-opus-4-6" }, claudeCaps),
    ).toBe("claude-opus-4-6[1m]");
    expect(
      resolveApiModelId(
        { provider: "claudeAgent", model: "claude-opus-4-6", options: {} },
        claudeCaps,
      ),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("returns the model as-is for explicit 200k (no suffix needed)", () => {
    expect(
      resolveApiModelId(
        { provider: "claudeAgent", model: "claude-opus-4-6", options: { contextWindow: "200k" } },
        claudeCaps,
      ),
    ).toBe("claude-opus-4-6");
  });

  it("falls back to default when context window value is unsupported", () => {
    // bogus is not in contextWindowOptions, so falls back to default (1m)
    expect(
      resolveApiModelId(
        { provider: "claudeAgent", model: "claude-opus-4-6", options: { contextWindow: "bogus" } },
        claudeCaps,
      ),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("returns the model as-is when model has no context window options", () => {
    const haikuCaps: ModelCapabilities = {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    };
    expect(
      resolveApiModelId(
        { provider: "claudeAgent", model: "claude-haiku-4-5", options: { contextWindow: "1m" } },
        haikuCaps,
      ),
    ).toBe("claude-haiku-4-5");
  });

  it("returns the model as-is for Codex selections", () => {
    expect(resolveApiModelId({ provider: "codex", model: "gpt-5.4" }, codexCaps)).toBe("gpt-5.4");
  });
});
