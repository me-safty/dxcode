import { describe, expect, it } from "@effect/vitest";

import { acknowledgeComposerNativeEvent } from "./composerEditorRevision";

describe("acknowledgeComposerNativeEvent", () => {
  it("advances to newer native text revisions", () => {
    expect(acknowledgeComposerNativeEvent(4, 5)).toBe(5);
  });

  it("accepts a duplicate event from the current native revision", () => {
    expect(acknowledgeComposerNativeEvent(5, 5)).toBe(5);
  });

  it("rejects events older than the latest native text revision", () => {
    expect(acknowledgeComposerNativeEvent(5, 4)).toBeNull();
  });

  it("rejects malformed revision counters", () => {
    expect(acknowledgeComposerNativeEvent(5, Number.NaN)).toBeNull();
    expect(acknowledgeComposerNativeEvent(5, 5.5)).toBeNull();
  });
});
