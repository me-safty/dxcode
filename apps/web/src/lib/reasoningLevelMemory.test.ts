import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { getRememberedReasoningLevel, withRememberedReasoningLevel } from "./reasoningLevelMemory";

const codex = ProviderDriverKind.make("codex");
const claudeAgent = ProviderDriverKind.make("claudeAgent");

describe("getRememberedReasoningLevel", () => {
  it("returns the stored value when the key exists", () => {
    const settings = {
      reasoningLevelByProviderModel: {
        "claudeAgent:claude-sonnet-4-6": "medium",
        "codex:gpt-5.4": "xhigh",
      },
    };
    expect(getRememberedReasoningLevel(settings, claudeAgent, "claude-sonnet-4-6")).toBe("medium");
    expect(getRememberedReasoningLevel(settings, codex, "gpt-5.4")).toBe("xhigh");
  });

  it("normalizes aliases so lookups are stable", () => {
    const settings = {
      reasoningLevelByProviderModel: {
        "claudeAgent:claude-sonnet-4-6": "medium",
      },
    };
    expect(getRememberedReasoningLevel(settings, claudeAgent, "sonnet")).toBe("medium");
  });

  it("returns null for unknown entries or empty input", () => {
    const settings = { reasoningLevelByProviderModel: {} };
    expect(getRememberedReasoningLevel(settings, codex, "gpt-5.4")).toBeNull();
    expect(getRememberedReasoningLevel(settings, codex, null)).toBeNull();
    expect(getRememberedReasoningLevel(settings, codex, undefined)).toBeNull();
    expect(getRememberedReasoningLevel(settings, codex, "")).toBeNull();
  });

  it("returns null when the stored value is a blank string", () => {
    const settings = {
      reasoningLevelByProviderModel: {
        "codex:gpt-5.4": "",
      },
    };
    expect(getRememberedReasoningLevel(settings, codex, "gpt-5.4")).toBeNull();
  });
});

describe("withRememberedReasoningLevel", () => {
  it("preserves entries for other models when updating one", () => {
    const settings = {
      reasoningLevelByProviderModel: {
        "claudeAgent:claude-opus-4-7": "high",
      },
    };
    const next = withRememberedReasoningLevel(settings, claudeAgent, "claude-sonnet-4-6", "medium");
    expect(next).toEqual({
      "claudeAgent:claude-opus-4-7": "high",
      "claudeAgent:claude-sonnet-4-6": "medium",
    });
  });

  it("overwrites an existing entry without touching siblings", () => {
    const settings = {
      reasoningLevelByProviderModel: {
        "claudeAgent:claude-opus-4-7": "high",
        "codex:gpt-5.4": "medium",
      },
    };
    const next = withRememberedReasoningLevel(settings, codex, "gpt-5.4", "xhigh");
    expect(next).toEqual({
      "claudeAgent:claude-opus-4-7": "high",
      "codex:gpt-5.4": "xhigh",
    });
  });

  it("trims the incoming value before storing", () => {
    const next = withRememberedReasoningLevel(
      { reasoningLevelByProviderModel: {} },
      codex,
      "gpt-5.4",
      "  high  ",
    );
    expect(next).toEqual({ "codex:gpt-5.4": "high" });
  });

  it("returns null when the key or value cannot be derived", () => {
    const settings = { reasoningLevelByProviderModel: {} };
    expect(withRememberedReasoningLevel(settings, codex, "   ", "high")).toBeNull();
    expect(withRememberedReasoningLevel(settings, codex, "gpt-5.4", "")).toBeNull();
    expect(withRememberedReasoningLevel(settings, codex, "gpt-5.4", "   ")).toBeNull();
  });
});
