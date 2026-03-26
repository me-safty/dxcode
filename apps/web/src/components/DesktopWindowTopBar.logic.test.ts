import { describe, expect, it } from "vitest";
import type { DesktopWindowState } from "@t3tools/contracts";

import {
  DESKTOP_WINDOW_TOP_BAR_HEIGHT_PX,
  DESKTOP_WINDOW_TOP_BAR_REVEAL_ZONE_PX,
  nextDesktopWindowTopBarVisibility,
  resolveDesktopWindowTopBarZoomFactor,
  shouldOverlayDesktopWindowTopBar,
  shouldUseDesktopWindowTopBar,
} from "./DesktopWindowTopBar.logic";

const fullscreenDesktopState: DesktopWindowState = {
  isFullScreen: true,
  isMaximized: true,
  platform: "linux",
  titleBarMode: "t3code",
  zoomFactor: 1,
};

describe("DesktopWindowTopBar.logic", () => {
  it("uses the T3 Code title bar for desktop windows in t3code mode", () => {
    expect(shouldUseDesktopWindowTopBar(fullscreenDesktopState)).toBe(true);
    expect(
      shouldUseDesktopWindowTopBar({
        ...fullscreenDesktopState,
        titleBarMode: "system",
      }),
    ).toBe(false);
    expect(
      shouldUseDesktopWindowTopBar({
        ...fullscreenDesktopState,
        platform: "win32",
      }),
    ).toBe(true);
    expect(
      shouldUseDesktopWindowTopBar({
        ...fullscreenDesktopState,
        platform: "other",
      }),
    ).toBe(false);
  });

  it("overlays only while the window is fullscreen", () => {
    expect(shouldOverlayDesktopWindowTopBar(fullscreenDesktopState)).toBe(true);
    expect(
      shouldOverlayDesktopWindowTopBar({
        ...fullscreenDesktopState,
        isFullScreen: false,
      }),
    ).toBe(false);
  });

  it("falls back to a zoom factor of 1 for invalid values", () => {
    expect(resolveDesktopWindowTopBarZoomFactor(fullscreenDesktopState)).toBe(1);
    expect(
      resolveDesktopWindowTopBarZoomFactor({
        ...fullscreenDesktopState,
        zoomFactor: 0,
      }),
    ).toBe(1);
  });

  it("keeps the bar always visible for non-fullscreen T3 Code windows", () => {
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: {
          ...fullscreenDesktopState,
          isFullScreen: false,
        },
        pointerY: null,
        isHovered: false,
        wasVisible: false,
      }),
    ).toBe(true);
  });

  it("reveals the fullscreen bar only when the pointer reaches the top edge initially", () => {
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: fullscreenDesktopState,
        pointerY: DESKTOP_WINDOW_TOP_BAR_REVEAL_ZONE_PX,
        isHovered: false,
        wasVisible: false,
      }),
    ).toBe(true);
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: fullscreenDesktopState,
        pointerY: DESKTOP_WINDOW_TOP_BAR_REVEAL_ZONE_PX + 1,
        isHovered: false,
        wasVisible: false,
      }),
    ).toBe(false);
  });

  it("keeps the fullscreen bar visible while the pointer stays inside the overlay height", () => {
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: fullscreenDesktopState,
        pointerY: DESKTOP_WINDOW_TOP_BAR_HEIGHT_PX,
        isHovered: false,
        wasVisible: true,
      }),
    ).toBe(true);
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: fullscreenDesktopState,
        pointerY: DESKTOP_WINDOW_TOP_BAR_HEIGHT_PX + 1,
        isHovered: false,
        wasVisible: true,
      }),
    ).toBe(false);
  });

  it("scales the reveal thresholds against the active zoom factor", () => {
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: {
          ...fullscreenDesktopState,
          zoomFactor: 2,
        },
        pointerY: DESKTOP_WINDOW_TOP_BAR_REVEAL_ZONE_PX / 2,
        isHovered: false,
        wasVisible: false,
      }),
    ).toBe(true);
    expect(
      nextDesktopWindowTopBarVisibility({
        windowState: {
          ...fullscreenDesktopState,
          zoomFactor: 2,
        },
        pointerY: DESKTOP_WINDOW_TOP_BAR_HEIGHT_PX / 2 + 1,
        isHovered: false,
        wasVisible: true,
      }),
    ).toBe(false);
  });
});
