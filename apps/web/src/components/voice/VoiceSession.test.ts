import { describe, expect, it } from "vite-plus/test";

import { applyExactComposerEdits } from "./VoiceSession";

describe("applyExactComposerEdits", () => {
  it("applies multiple exact edits in order", () => {
    expect(
      applyExactComposerEdits("Draft a long prompt about React.", [
        { oldText: "long", newText: "concise" },
        { oldText: "React", newText: "T3 Code" },
      ]),
    ).toEqual({ ok: true, text: "Draft a concise prompt about T3 Code." });
  });

  it("rejects missing and ambiguous matches without changing text", () => {
    expect(applyExactComposerEdits("one two", [{ oldText: "three", newText: "four" }])).toEqual({
      ok: false,
      error: "An oldText block was not found exactly in the composer.",
    });
    expect(applyExactComposerEdits("one one", [{ oldText: "one", newText: "two" }])).toEqual({
      ok: false,
      error: "An oldText block matched more than once. Include more surrounding text.",
    });
  });
});
