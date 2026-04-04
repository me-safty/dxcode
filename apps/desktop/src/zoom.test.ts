import { describe, expect, it, vi } from "vitest";

import { getDesktopZoomState, setDesktopZoomLevel } from "./zoom";

function createWindow(level = 0, factor = 1) {
  const webContents = {
    getZoomLevel: vi.fn(() => level),
    getZoomFactor: vi.fn(() => factor),
    setZoomLevel: vi.fn((nextLevel: number) => {
      level = nextLevel;
      factor = 1.2 ** nextLevel;
    }),
  };

  return { webContents };
}

describe("desktop zoom helpers", () => {
  it("returns canonical zoom state", () => {
    const targetWindow = createWindow(1, 1.2);

    expect(getDesktopZoomState(targetWindow as never)).toEqual({
      level: 1,
      factor: 1.2,
      percent: 120,
    });
  });

  it("clamps and applies zoom levels", () => {
    const targetWindow = createWindow(0, 1);

    expect(setDesktopZoomLevel(targetWindow as never, 99)).toEqual({
      level: 8,
      factor: 1.2 ** 8,
      percent: Math.round(1.2 ** 8 * 100),
    });
    expect(targetWindow.webContents.setZoomLevel).toHaveBeenCalledWith(8);
  });
});
