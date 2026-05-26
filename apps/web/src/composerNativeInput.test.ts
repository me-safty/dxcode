import { describe, expect, it } from "vitest";

import {
  createComposerNativeInputTracker,
  isComposerNativeComposingKeyEvent,
  isComposerNativeInputSettling,
  markComposerNativeInputSuppression,
  readComposerNativeInputChangeMetadata,
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

  it("lets iOS WebKit own collapsed-cursor insertText so predictive text is preserved", () => {
    expect(
      shouldLetBrowserHandleComposerBeforeInput("insertText", {
        isIosWebkit: true,
        isSelectionCollapsed: true,
      }),
    ).toBe(true);
  });

  it("keeps Lexical's insertText handler when iOS has a selection range (surround feature)", () => {
    expect(
      shouldLetBrowserHandleComposerBeforeInput("insertText", {
        isIosWebkit: true,
        isSelectionCollapsed: false,
      }),
    ).toBe(false);
  });

  it("keeps Lexical's insertText handler on non-iOS platforms", () => {
    expect(
      shouldLetBrowserHandleComposerBeforeInput("insertText", {
        isIosWebkit: false,
        isSelectionCollapsed: true,
      }),
    ).toBe(false);
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

  it("reports settling while composition is active", () => {
    const tracker = createComposerNativeInputTracker();
    tracker.isComposing = true;

    expect(isComposerNativeInputSettling(tracker, 1_000)).toBe(true);
    expect(readComposerNativeInputChangeMetadata(tracker).suppressTriggerDetection).toBe(true);
  });

  it("reports settling during the suppression window", () => {
    const tracker = createComposerNativeInputTracker();
    markComposerNativeInputSuppression(tracker, "insertText");

    expect(isComposerNativeInputSettling(tracker, tracker.suppressTriggerDetectionUntil - 1)).toBe(
      true,
    );
    expect(readComposerNativeInputChangeMetadata(tracker).suppressTriggerDetection).toBe(true);
  });

  it("stops settling after the suppression window ends", () => {
    const tracker = createComposerNativeInputTracker();
    tracker.suppressTriggerDetectionUntil = 0;

    expect(isComposerNativeInputSettling(tracker, 0)).toBe(false);
    expect(readComposerNativeInputChangeMetadata(tracker).suppressTriggerDetection).toBe(false);
  });
});
