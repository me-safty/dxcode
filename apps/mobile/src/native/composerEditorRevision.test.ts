import { describe, expect, it } from "@effect/vitest";

import {
  acknowledgeComposerNativeEvent,
  resolveComposerControlledEventCount,
} from "./composerEditorRevision";

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

describe("resolveComposerControlledEventCount", () => {
  const snapshots = [
    { eventCount: 0, value: "" },
    { eventCount: 2, value: "a" },
    { eventCount: 4, value: "ab" },
  ];

  it("tags a delayed parent value with the native revision that produced it", () => {
    expect(resolveComposerControlledEventCount("a", 4, snapshots)).toBe(2);
  });

  it("does not acknowledge the pre-edit parent value as the latest revision", () => {
    expect(resolveComposerControlledEventCount("", 4, snapshots)).toBe(0);
  });

  it("acknowledges the latest native value at the latest revision", () => {
    expect(resolveComposerControlledEventCount("ab", 4, snapshots)).toBe(4);
  });

  it("allows an unmatched parent-driven edit at the latest native revision", () => {
    expect(resolveComposerControlledEventCount("/plan ", 4, snapshots)).toBe(4);
  });

  it("uses the newest revision when selection events repeat the same value", () => {
    expect(
      resolveComposerControlledEventCount("ab", 5, [...snapshots, { eventCount: 5, value: "ab" }]),
    ).toBe(5);
  });
});
