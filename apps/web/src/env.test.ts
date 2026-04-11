import { describe, expect, it } from "vitest";

import { shouldRenderDesktopChromeHeader } from "./env";

describe("shouldRenderDesktopChromeHeader", () => {
  it("returns false on web", () => {
    expect(shouldRenderDesktopChromeHeader({ platform: "web" })).toBe(false);
  });

  it("returns true on macos", () => {
    expect(shouldRenderDesktopChromeHeader({ platform: "macos" })).toBe(true);
  });

  it("returns true on windows", () => {
    expect(shouldRenderDesktopChromeHeader({ platform: "windows" })).toBe(true);
  });

  it("returns true on linux when the title bar is custom", () => {
    expect(
      shouldRenderDesktopChromeHeader({
        platform: "linux",
        linuxTitleBarMode: "custom",
      }),
    ).toBe(true);
  });

  it("returns false on linux native title bar mode", () => {
    expect(
      shouldRenderDesktopChromeHeader({
        platform: "linux",
        linuxTitleBarMode: "native",
      }),
    ).toBe(false);
  });
});
