import type { DesktopWindowSize } from "./desktopSettings.ts";

export const DEFAULT_WINDOW_WIDTH = 1100;
export const DEFAULT_WINDOW_HEIGHT = 780;
export const MIN_WINDOW_WIDTH = 840;
export const MIN_WINDOW_HEIGHT = 620;

export function resolveInitialWindowSize(saved: DesktopWindowSize | undefined): DesktopWindowSize {
  if (!saved) {
    return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
  }
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(saved.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(saved.height)),
  };
}
