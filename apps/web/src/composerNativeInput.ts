export const COMPOSER_NATIVE_INPUT_SETTLE_MS = 120;

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

export type ComposerNativeInputChangeMetadata = {
  suppressTriggerDetection: boolean;
  isComposing: boolean;
  inputType: string | null;
};

export type ComposerNativeInputKeyEventLike = {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  which?: number;
};

export function shouldSuppressComposerTriggerForNativeInputType(
  inputType: string | null | undefined,
): boolean {
  return typeof inputType === "string" && COMPOSER_TRIGGER_SUPPRESSING_INPUT_TYPES.has(inputType);
}

export function shouldLetBrowserHandleComposerBeforeInput(
  inputType: string | null | undefined,
): boolean {
  return (
    typeof inputType === "string" && COMPOSER_BROWSER_HANDLED_BEFORE_INPUT_TYPES.has(inputType)
  );
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
