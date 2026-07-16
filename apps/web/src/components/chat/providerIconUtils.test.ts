import { describe, expect, it } from "vite-plus/test";

import {
  getDisplayModelName,
  getModelPickerDisplayAlias,
  getTriggerDisplayModelName,
} from "./providerIconUtils";

describe("getModelPickerDisplayAlias", () => {
  it("shortens GPT model names while preserving model family suffixes", () => {
    expect(getModelPickerDisplayAlias("GPT-5.6-Sol")).toBe("5.6 Sol");
    expect(getModelPickerDisplayAlias("GPT-5.6-Terra")).toBe("5.6 Terra");
    expect(getModelPickerDisplayAlias("GPT-5.4-Mini")).toBe("5.4 Mini");
  });

  it("shortens older GPT model names to the numeric version", () => {
    expect(getModelPickerDisplayAlias("GPT-5.5")).toBe("5.5");
    expect(getModelPickerDisplayAlias("GPT-5.4")).toBe("5.4");
  });

  it("removes the Claude prefix from Claude model names", () => {
    expect(getModelPickerDisplayAlias("Claude Fable 5")).toBe("Fable 5");
    expect(getModelPickerDisplayAlias("Claude Sonnet 5")).toBe("Sonnet 5");
    expect(getModelPickerDisplayAlias("Claude Opus 4.8")).toBe("Opus 4.8");
  });
});

describe("getDisplayModelName", () => {
  it("applies aliases after removing sub-provider qualifiers", () => {
    expect(
      getDisplayModelName({
        slug: "openai/gpt-5.6-sol",
        name: "OpenAI: GPT-5.6-Sol",
        subProvider: "OpenAI",
      }),
    ).toBe("5.6 Sol");
  });

  it("applies aliases to preferred short names used by the picker trigger", () => {
    expect(
      getTriggerDisplayModelName({
        slug: "gpt-5.5",
        name: "GPT-5.5",
        shortName: "GPT-5.5",
      }),
    ).toBe("5.5");
  });
});
