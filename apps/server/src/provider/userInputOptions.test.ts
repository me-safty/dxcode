import { describe, expect, it } from "vitest";

import { withCustomUserInputOption } from "./userInputOptions.ts";

describe("withCustomUserInputOption", () => {
  it("preserves all preset options and appends Other as the custom prompt", () => {
    expect(
      withCustomUserInputOption([
        { label: "One", description: "First" },
        { label: "Two", description: "Second" },
        { label: "Three", description: "Third" },
        { label: "Four", description: "Fourth" },
      ]),
    ).toEqual([
      { label: "One", description: "First" },
      { label: "Two", description: "Second" },
      { label: "Three", description: "Third" },
      { label: "Four", description: "Fourth" },
      { label: "Other", description: "Type your own answer" },
    ]);
  });

  it("preserves a provider-supplied Other option but keeps it last", () => {
    expect(
      withCustomUserInputOption([
        { label: "Other", description: "Write one" },
        { label: "One", description: "First" },
      ]),
    ).toEqual([
      { label: "One", description: "First" },
      { label: "Other", description: "Write one" },
    ]);
  });
});
