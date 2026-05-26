export const COMPOSER_NATIVE_INPUT_SETTLE_MS = 250;

const COMPOSER_TRIGGER_SUPPRESSING_INPUT_TYPES = new Set([
  "insertCompositionText",
  "insertFromComposition",
  "insertReplacementText",
]);

const COMPOSER_BROWSER_HANDLED_BEFORE_INPUT_TYPES = new Set([
  "insertCompositionText",
  "insertFromComposition",
  "insertReplacementText",
]);

// On iOS WebKit, Lexical's DOM reconciliation on every keystroke resets the
// system's predictive-text/autocorrect tracking (auto-apostrophe, double-space
// period, sentence capitalization). Letting the browser own plain insertText
// while the selection is collapsed avoids that — Lexical syncs state from the
// resulting DOM mutation. We keep Lexical's path when there's a selection
// range so the surround-with-quotes feature still works.
const COMPOSER_IOS_BROWSER_HANDLED_COLLAPSED_BEFORE_INPUT_TYPES = new Set(["insertText"]);

export type ComposerNativeInputChangeMetadata = {
  suppressTriggerDetection: boolean;
  isComposing: boolean;
  inputType: string | null;
};

export type ComposerNativeInputTracker = {
  isComposing: boolean;
  lastInputType: string | null;
  suppressTriggerDetectionUntil: number;
};

export type ComposerNativeInputKeyEventLike = {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  which?: number;
};

function composerNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function createComposerNativeInputTracker(): ComposerNativeInputTracker {
  return {
    isComposing: false,
    lastInputType: null,
    suppressTriggerDetectionUntil: 0,
  };
}

export function isComposerNativeInputSettling(
  tracker: ComposerNativeInputTracker,
  nowMs = composerNowMs(),
): boolean {
  return tracker.isComposing || nowMs < tracker.suppressTriggerDetectionUntil;
}

export function markComposerNativeInputSuppression(
  tracker: ComposerNativeInputTracker,
  inputType: string | null,
): void {
  tracker.lastInputType = inputType;
  tracker.suppressTriggerDetectionUntil = composerNowMs() + COMPOSER_NATIVE_INPUT_SETTLE_MS;
}

export function readComposerNativeInputChangeMetadata(
  tracker: ComposerNativeInputTracker,
): ComposerNativeInputChangeMetadata {
  return {
    suppressTriggerDetection: isComposerNativeInputSettling(tracker),
    isComposing: tracker.isComposing,
    inputType: tracker.lastInputType,
  };
}

export function shouldSuppressComposerTriggerForNativeInputType(
  inputType: string | null | undefined,
): boolean {
  return typeof inputType === "string" && COMPOSER_TRIGGER_SUPPRESSING_INPUT_TYPES.has(inputType);
}

export type ComposerBeforeInputContext = {
  readonly isIosWebkit: boolean;
  readonly isSelectionCollapsed: boolean;
};

export function shouldLetBrowserHandleComposerBeforeInput(
  inputType: string | null | undefined,
  context: ComposerBeforeInputContext = { isIosWebkit: false, isSelectionCollapsed: true },
): boolean {
  if (typeof inputType !== "string") return false;
  if (COMPOSER_BROWSER_HANDLED_BEFORE_INPUT_TYPES.has(inputType)) return true;
  if (
    context.isIosWebkit &&
    context.isSelectionCollapsed &&
    COMPOSER_IOS_BROWSER_HANDLED_COLLAPSED_BEFORE_INPUT_TYPES.has(inputType)
  ) {
    return true;
  }
  return false;
}

export function isComposerNativeComposingKeyEvent(event: ComposerNativeInputKeyEventLike): boolean {
  return (
    event.isComposing === true ||
    event.key === "Process" ||
    event.key === "Unidentified" ||
    event.keyCode === 229 ||
    event.which === 229
  );
}
