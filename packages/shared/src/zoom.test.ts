import { describe, expect, it } from "vitest";

import {
  clampWindowZoomLevel,
  MAX_WINDOW_ZOOM_LEVEL,
  MIN_WINDOW_ZOOM_LEVEL,
  zoomLevelToPercent,
  zoomLevelToZoomFactor,
} from "./zoom";

describe("zoom helpers", () => {
  it("clamps to the supported zoom range", () => {
    expect(clampWindowZoomLevel(MIN_WINDOW_ZOOM_LEVEL - 1)).toBe(MIN_WINDOW_ZOOM_LEVEL);
    expect(clampWindowZoomLevel(MAX_WINDOW_ZOOM_LEVEL + 1)).toBe(MAX_WINDOW_ZOOM_LEVEL);
    expect(clampWindowZoomLevel(2)).toBe(2);
  });

  it("normalizes invalid levels to zero", () => {
    expect(clampWindowZoomLevel(Number.NaN)).toBe(0);
    expect(clampWindowZoomLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("derives zoom factor and percent from the clamped level", () => {
    expect(zoomLevelToZoomFactor(0)).toBe(1);
    expect(zoomLevelToPercent(0)).toBe(100);
    expect(zoomLevelToPercent(1)).toBe(120);
    expect(zoomLevelToPercent(-1)).toBe(83);
  });
});
