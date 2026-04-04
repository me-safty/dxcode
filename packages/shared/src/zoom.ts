export const MIN_WINDOW_ZOOM_LEVEL = -8;
export const MAX_WINDOW_ZOOM_LEVEL = 8;

export function clampWindowZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }

  return Math.min(MAX_WINDOW_ZOOM_LEVEL, Math.max(MIN_WINDOW_ZOOM_LEVEL, level));
}

export function zoomLevelToZoomFactor(level: number): number {
  return 1.2 ** clampWindowZoomLevel(level);
}

export function zoomLevelToPercent(level: number): number {
  return Math.round(zoomLevelToZoomFactor(level) * 100);
}
