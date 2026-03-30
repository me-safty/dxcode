export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
const COMPOSER_FOOTER_CONTENT_GAP_PX = 8;

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldForceCompactComposerFooterForFit(input: {
  footerWidth: number | null;
  leadingContentWidth: number | null;
  actionsWidth: number | null;
}): boolean {
  const footerWidth = input.footerWidth;
  const leadingContentWidth = input.leadingContentWidth;
  const actionsWidth = input.actionsWidth;
  if (footerWidth === null || leadingContentWidth === null || actionsWidth === null) {
    return false;
  }
  return leadingContentWidth + actionsWidth + COMPOSER_FOOTER_CONTENT_GAP_PX > footerWidth;
}
