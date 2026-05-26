import { describe, expect, it, vi } from "vitest";

import {
  LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX,
  clearDocumentSelection,
  hasLongPressMovedBeyondTolerance,
  shouldStartLongPressContextMenu,
} from "./useLongPressContextMenu";

describe("shouldStartLongPressContextMenu", () => {
  it("accepts primary touch presses", () => {
    expect(
      shouldStartLongPressContextMenu({
        button: 0,
        isPrimary: true,
        pointerType: "touch",
      }),
    ).toBe(true);
  });

  it("rejects mouse, secondary, and non-primary presses", () => {
    expect(
      shouldStartLongPressContextMenu({
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      }),
    ).toBe(false);
    expect(
      shouldStartLongPressContextMenu({
        button: 2,
        isPrimary: true,
        pointerType: "touch",
      }),
    ).toBe(false);
    expect(
      shouldStartLongPressContextMenu({
        button: 0,
        isPrimary: false,
        pointerType: "touch",
      }),
    ).toBe(false);
  });
});

describe("clearDocumentSelection", () => {
  it("clears selection ranges when selection APIs are available", () => {
    const removeAllRanges = vi.fn();

    clearDocumentSelection({
      getSelection: () => ({ removeAllRanges }),
    });

    expect(removeAllRanges).toHaveBeenCalledOnce();
  });

  it("does not throw when selection APIs are unavailable", () => {
    expect(() => clearDocumentSelection(undefined)).not.toThrow();
    expect(() => clearDocumentSelection({})).not.toThrow();
  });
});

describe("hasLongPressMovedBeyondTolerance", () => {
  it("keeps small finger drift inside the long-press tolerance", () => {
    expect(
      hasLongPressMovedBeyondTolerance({
        currentX: 6,
        currentY: 8,
        startX: 0,
        startY: 0,
      }),
    ).toBe(false);
  });

  it("cancels when movement exceeds the configured tolerance", () => {
    expect(
      hasLongPressMovedBeyondTolerance({
        currentX: LONG_PRESS_CONTEXT_MENU_MOVE_TOLERANCE_PX + 1,
        currentY: 0,
        startX: 0,
        startY: 0,
      }),
    ).toBe(true);
  });
});
