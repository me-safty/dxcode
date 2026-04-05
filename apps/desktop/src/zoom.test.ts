import { describe, expect, it, vi } from "vitest";

import { getDesktopZoomState, setDesktopZoomLevel } from "./zoom";

function createZoomTarget() {
  return {
    setZoomLevel: vi.fn(),
  };
}

describe("desktop zoom helpers", () => {
  it("returns canonical zoom state", () => {
    expect(getDesktopZoomState(1)).toEqual({
      level: 1,
      factor: 1.2,
      percent: 120,
    });
  });

  it("clamps and applies zoom levels", () => {
    const target = createZoomTarget();

    expect(setDesktopZoomLevel(target, 99)).toEqual({
      level: 8,
      factor: 1.2 ** 8,
      percent: Math.round(1.2 ** 8 * 100),
    });
    expect(target.setZoomLevel).toHaveBeenCalledWith(8);
  });

  it("applies rapid local increments monotonically without queueing", () => {
    const target = createZoomTarget();

    expect(setDesktopZoomLevel(target, 1)).toMatchObject({
      level: 1,
      percent: 120,
    });
    expect(setDesktopZoomLevel(target, 2)).toMatchObject({
      level: 2,
      percent: 144,
    });
    expect(target.setZoomLevel).toHaveBeenNthCalledWith(1, 1);
    expect(target.setZoomLevel).toHaveBeenNthCalledWith(2, 2);
  });
});
