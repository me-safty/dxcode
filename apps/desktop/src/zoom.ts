import type { BrowserWindow } from "electron";
import type { DesktopZoomState } from "@t3tools/contracts";
import {
  clampWindowZoomLevel,
  zoomLevelToPercent,
  zoomLevelToZoomFactor,
} from "@t3tools/shared/zoom";

type ZoomableWindow = Pick<BrowserWindow, "webContents">;

export function getDesktopZoomState(targetWindow: ZoomableWindow): DesktopZoomState {
  const level = clampWindowZoomLevel(targetWindow.webContents.getZoomLevel());
  const rawFactor = targetWindow.webContents.getZoomFactor();
  const factor = Number.isFinite(rawFactor) ? rawFactor : zoomLevelToZoomFactor(level);

  return {
    level,
    factor,
    percent: zoomLevelToPercent(level),
  };
}

export function setDesktopZoomLevel(targetWindow: ZoomableWindow, level: number): DesktopZoomState {
  const clampedLevel = clampWindowZoomLevel(level);
  targetWindow.webContents.setZoomLevel(clampedLevel);
  return getDesktopZoomState(targetWindow);
}
