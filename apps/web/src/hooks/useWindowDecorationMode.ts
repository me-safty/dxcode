import { isElectron } from "~/env";
import { useDesktopWindowState } from "~/hooks/useDesktopWindowState";
import { useSettings } from "~/hooks/useSettings";
import { isMacPlatform } from "~/lib/utils";

function shouldUseDesktopHeaderDragRegion(
  windowState: ReturnType<typeof useDesktopWindowState>,
  desktopTitleBarMode: ReturnType<typeof useSettings>["desktopTitleBarMode"],
): boolean {
  if (!isElectron) {
    return false;
  }

  if (!windowState) {
    return desktopTitleBarMode === "t3code" || isMacPlatform(navigator.platform);
  }

  if (windowState.platform === "other") {
    return false;
  }

  return windowState.titleBarMode === "t3code" || windowState.platform === "darwin";
}

export function useShouldUseDesktopHeaderDragRegion(): boolean {
  const windowState = useDesktopWindowState();
  const desktopTitleBarMode = useSettings().desktopTitleBarMode;

  return shouldUseDesktopHeaderDragRegion(windowState, desktopTitleBarMode);
}
