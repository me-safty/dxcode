import { describe, expect, it } from "vitest";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldForceCompactComposerFooterForFit,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldForceCompactComposerFooterForFit", () => {
  it("stays expanded when content widths fit within the footer", () => {
    expect(
      shouldForceCompactComposerFooterForFit({
        footerWidth: 500,
        leadingContentWidth: 320,
        actionsWidth: 160,
      }),
    ).toBe(false);
  });

  it("forces compact mode when content no longer fits on one line", () => {
    expect(
      shouldForceCompactComposerFooterForFit({
        footerWidth: 500,
        leadingContentWidth: 340,
        actionsWidth: 180,
      }),
    ).toBe(true);
  });

  it("ignores incomplete measurements", () => {
    expect(
      shouldForceCompactComposerFooterForFit({
        footerWidth: null,
        leadingContentWidth: 340,
        actionsWidth: 180,
      }),
    ).toBe(false);
  });
});
