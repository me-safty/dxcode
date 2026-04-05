import { describe, expect, it } from "vitest";

import { isDesktopHandledZoomAccelerator } from "./desktopZoomShortcuts";

describe("isDesktopHandledZoomAccelerator", () => {
  it("matches Electron's built-in zoom accelerators", () => {
    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "=",
          code: "Equal",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);

    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "+",
          code: "Equal",
          metaKey: true,
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);

    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "-",
          code: "NumpadSubtract",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
        },
        "Win32",
      ),
    ).toBe(true);

    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "0",
          code: "Digit0",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
        },
        "Linux x86_64",
      ),
    ).toBe(true);
  });

  it("ignores non-accelerator modifier combinations", () => {
    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "-",
          code: "Minus",
          metaKey: false,
          ctrlKey: true,
          shiftKey: true,
          altKey: false,
        },
        "Win32",
      ),
    ).toBe(false);

    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "0",
          code: "Digit0",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: true,
        },
        "Win32",
      ),
    ).toBe(false);

    expect(
      isDesktopHandledZoomAccelerator(
        {
          key: "+",
          code: "Equal",
          metaKey: false,
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
        },
        "Linux x86_64",
      ),
    ).toBe(false);
  });
});
