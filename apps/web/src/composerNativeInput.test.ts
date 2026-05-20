import { describe, expect, it } from "vitest";

import {
  isComposerNativeComposingKeyEvent,
  shouldLetBrowserHandleComposerBeforeInput,
  shouldSuppressComposerTriggerForNativeInputType,
} from "./composerNativeInput";

describe("composerNativeInput", () => {
  it("suppresses trigger detection for active composition text", () => {
    expect(shouldSuppressComposerTriggerForNativeInputType("insertCompositionText")).toBe(true);
  });

  it("suppresses trigger detection for committed composition text", () => {
    expect(shouldSuppressComposerTriggerForNativeInputType("insertFromComposition")).toBe(true);
  });

  it("suppresses trigger detection for native replacement text", () => {
    expect(shouldSuppressComposerTriggerForNativeInputType("insertReplacementText")).toBe(true);
  });

  it("does not suppress trigger detection for regular text insertion", () => {
    expect(shouldSuppressComposerTriggerForNativeInputType("insertText")).toBe(false);
  });

  it("lets the browser own native composition and replacement beforeinput events", () => {
    expect(shouldLetBrowserHandleComposerBeforeInput("insertCompositionText")).toBe(true);
    expect(shouldLetBrowserHandleComposerBeforeInput("insertFromComposition")).toBe(true);
    expect(shouldLetBrowserHandleComposerBeforeInput("insertReplacementText")).toBe(true);
    expect(shouldLetBrowserHandleComposerBeforeInput("insertText")).toBe(false);
  });

  it("treats composing keydown events as ineligible for command handling", () => {
    expect(isComposerNativeComposingKeyEvent({ isComposing: true, key: "a" })).toBe(true);
    expect(isComposerNativeComposingKeyEvent({ isComposing: false, key: "Process" })).toBe(true);
    expect(isComposerNativeComposingKeyEvent({ isComposing: false, key: "Unidentified" })).toBe(
      true,
    );
    expect(isComposerNativeComposingKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isComposerNativeComposingKeyEvent({ isComposing: false, which: 229 })).toBe(true);
    expect(isComposerNativeComposingKeyEvent({ isComposing: false, key: "Enter" })).toBe(false);
  });
});
