import { describe, expect, it } from "vitest";

import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";

describe("buildModelPickerSearchText", () => {
  it("builds provider-agnostic search text from generic fields", () => {
    expect(
      buildModelPickerSearchText({
        provider: "opencode",
        name: "GitHub Copilot · Claude Opus 4.7",
      }),
    ).toBe("github copilot · claude opus 4.7 opencode opencode");
  });
});

describe("scoreModelPickerSearch", () => {
  it("matches typo-tolerant multi-token queries", () => {
    expect(
      scoreModelPickerSearch(
        {
          provider: "opencode",
          name: "GitHub Copilot · Claude Opus 4.7",
        },
        "coplt op",
      ),
    ).not.toBeNull();
  });

  it("rejects results when any query token does not match", () => {
    expect(
      scoreModelPickerSearch(
        {
          provider: "codex",
          name: "GPT-5 Codex",
        },
        "coplt op",
      ),
    ).toBeNull();
  });

  it("ranks exact token matches ahead of fuzzier matches", () => {
    const exactScore = scoreModelPickerSearch(
      {
        provider: "opencode",
        name: "GitHub Copilot · Claude Opus 4.7",
      },
      "copilot opus",
    );
    const fuzzyScore = scoreModelPickerSearch(
      {
        provider: "opencode",
        name: "GitHub Copilot · Claude Opus 4.7",
      },
      "coplt op",
    );

    expect(exactScore).not.toBeNull();
    expect(fuzzyScore).not.toBeNull();
    expect(exactScore!).toBeLessThan(fuzzyScore!);
  });
});
