import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, DEFAULT_MODEL_BY_PROVIDER } from "./model.ts";

describe("model constants", () => {
  it("DEFAULT_MODEL equals claude-opus-4-6", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-4-6");
  });

  it("DEFAULT_MODEL_BY_PROVIDER.claudeAgent equals claude-opus-4-6", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER.claudeAgent).toBe("claude-opus-4-6");
  });

  it("DEFAULT_MODEL equals DEFAULT_MODEL_BY_PROVIDER.claudeAgent", () => {
    expect(DEFAULT_MODEL).toBe(DEFAULT_MODEL_BY_PROVIDER.claudeAgent);
  });
});
