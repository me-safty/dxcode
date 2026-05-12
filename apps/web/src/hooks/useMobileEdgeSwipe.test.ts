import { describe, expect, it } from "vitest";

import { isMobileEdgeSwipeStart, resolveMobileEdgeSwipeDecision } from "./useMobileEdgeSwipe";

describe("resolveMobileEdgeSwipeDecision", () => {
  it("opens the left panel after a horizontal rightward edge swipe", () => {
    expect(resolveMobileEdgeSwipeDecision({ deltaX: 64, deltaY: 12, side: "left" })).toBe("open");
  });

  it("opens the right panel after a horizontal leftward edge swipe", () => {
    expect(resolveMobileEdgeSwipeDecision({ deltaX: -64, deltaY: 12, side: "right" })).toBe("open");
  });

  it("closes the left panel after a horizontal leftward swipe", () => {
    expect(
      resolveMobileEdgeSwipeDecision({
        action: "close",
        deltaX: -64,
        deltaY: 12,
        side: "left",
      }),
    ).toBe("close");
  });

  it("closes the right panel after a horizontal rightward swipe", () => {
    expect(
      resolveMobileEdgeSwipeDecision({
        action: "close",
        deltaX: 64,
        deltaY: 12,
        side: "right",
      }),
    ).toBe("close");
  });

  it("keeps short horizontal movement pending", () => {
    expect(resolveMobileEdgeSwipeDecision({ deltaX: 32, deltaY: 4, side: "left" })).toBe("pending");
  });

  it("cancels vertical scrolling gestures", () => {
    expect(resolveMobileEdgeSwipeDecision({ deltaX: 18, deltaY: 40, side: "left" })).toBe("cancel");
  });

  it("accepts starts within the configured left edge band", () => {
    expect(isMobileEdgeSwipeStart({ viewportWidth: 390, x: 63, side: "left" })).toBe(true);
    expect(isMobileEdgeSwipeStart({ viewportWidth: 390, x: 65, side: "left" })).toBe(false);
  });

  it("accepts starts within the configured right edge band", () => {
    expect(isMobileEdgeSwipeStart({ viewportWidth: 390, x: 327, side: "right" })).toBe(true);
    expect(isMobileEdgeSwipeStart({ viewportWidth: 390, x: 325, side: "right" })).toBe(false);
  });

  it("accepts starts anywhere in the viewport for full-screen left swipes", () => {
    expect(
      isMobileEdgeSwipeStart({
        side: "left",
        startArea: "screen",
        viewportWidth: 390,
        x: 195,
      }),
    ).toBe(true);
  });

  it("accepts starts anywhere in the viewport for full-screen right swipes", () => {
    expect(
      isMobileEdgeSwipeStart({
        side: "right",
        startArea: "screen",
        viewportWidth: 390,
        x: 195,
      }),
    ).toBe(true);
  });
});
