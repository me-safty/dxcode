import type { DesktopZoomState } from "@t3tools/contracts";
import {
  clampWindowZoomLevel,
  zoomLevelToPercent,
  zoomLevelToZoomFactor,
} from "@t3tools/shared/zoom";

type WritableZoomTarget = {
  setZoomLevel: (level: number) => void;
};

export function getDesktopZoomState(level: number): DesktopZoomState {
  const clampedLevel = clampWindowZoomLevel(level);

  return {
    level: clampedLevel,
    factor: zoomLevelToZoomFactor(clampedLevel),
    percent: zoomLevelToPercent(clampedLevel),
  };
}

export function setDesktopZoomLevel(target: WritableZoomTarget, level: number): DesktopZoomState {
  const clampedLevel = clampWindowZoomLevel(level);
  target.setZoomLevel(clampedLevel);
  return getDesktopZoomState(clampedLevel);
}
