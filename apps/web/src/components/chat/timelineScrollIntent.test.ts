import { describe, expect, it } from "vitest";

import { createTouchScrollIntentTracker, isWheelScrollAwayIntent } from "./timelineScrollIntent";

describe("isWheelScrollAwayIntent", () => {
  it("treats upward wheels as scroll-away intent", () => {
    expect(isWheelScrollAwayIntent(-12)).toBe(true);
  });

  it("ignores downward and resting wheels", () => {
    expect(isWheelScrollAwayIntent(12)).toBe(false);
    expect(isWheelScrollAwayIntent(0)).toBe(false);
  });
});

describe("createTouchScrollIntentTracker", () => {
  it("reports intent when the finger moves down the screen (scrolling content up)", () => {
    const tracker = createTouchScrollIntentTracker();
    tracker.touchStart(100);
    expect(tracker.touchMove(140)).toBe(true);
  });

  it("does not report intent when the finger moves up the screen (scrolling content down)", () => {
    const tracker = createTouchScrollIntentTracker();
    tracker.touchStart(100);
    expect(tracker.touchMove(60)).toBe(false);
  });

  it("does not report intent on the first move without a start", () => {
    const tracker = createTouchScrollIntentTracker();
    expect(tracker.touchMove(100)).toBe(false);
    // Subsequent downward move is now tracked relative to the seeded position.
    expect(tracker.touchMove(140)).toBe(true);
  });

  it("resets tracking on a new touchStart", () => {
    const tracker = createTouchScrollIntentTracker();
    tracker.touchStart(200);
    expect(tracker.touchMove(240)).toBe(true);

    tracker.touchStart(100);
    // First move after reset compares against the new start position.
    expect(tracker.touchMove(80)).toBe(false);
  });
});
