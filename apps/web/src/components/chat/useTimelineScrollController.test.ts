import { describe, expect, it } from "vite-plus/test";
import { isTimelineScrollKeyboardNavigationKey } from "./useTimelineScrollController";

describe("timeline scroll controller", () => {
  it("recognizes keyboard keys that can move the timeline scroll position", () => {
    expect(isTimelineScrollKeyboardNavigationKey("ArrowUp")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey("ArrowDown")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey("PageUp")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey("PageDown")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey("Home")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey("End")).toBe(true);
    expect(isTimelineScrollKeyboardNavigationKey(" ")).toBe(true);
  });

  it("ignores non-navigation keys", () => {
    expect(isTimelineScrollKeyboardNavigationKey("Enter")).toBe(false);
    expect(isTimelineScrollKeyboardNavigationKey("Escape")).toBe(false);
    expect(isTimelineScrollKeyboardNavigationKey("a")).toBe(false);
  });
});
