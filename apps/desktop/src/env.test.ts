import { describe, expect, it } from "vitest";

import { getWindowControlsLayout } from "./env";

describe("getWindowControlsLayout", () => {
  it("uses the standard macOS traffic-light placement in ltr locales", () => {
    expect(getWindowControlsLayout({ locale: "en-US", platform: "macos" })).toEqual({
      left: ["close", "minimize", "maximize"],
      right: [],
    });
  });

  it("mirrors macOS traffic lights in rtl locales", () => {
    expect(getWindowControlsLayout({ locale: "ar", platform: "macos" })).toEqual({
      left: [],
      right: ["maximize", "minimize", "close"],
    });
  });

  it("uses the standard Windows control layout in ltr locales", () => {
    expect(getWindowControlsLayout({ locale: "en-US", platform: "windows" })).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });

  it("mirrors Windows controls in rtl locales", () => {
    expect(getWindowControlsLayout({ locale: "he", platform: "windows" })).toEqual({
      left: ["close", "maximize", "minimize"],
      right: [],
    });
  });

  it("keeps Linux layout unchanged even in rtl locales", () => {
    expect(getWindowControlsLayout({ locale: "ar", platform: "linux" })).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });
});
