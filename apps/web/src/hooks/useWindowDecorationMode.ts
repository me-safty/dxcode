import { isElectron } from "~/env";
import { useDesktopWindowState } from "~/hooks/useDesktopWindowState";
import { useSettings } from "~/hooks/useSettings";

export function useShouldUseT3CodeWindowDecoration(): boolean {
  const windowState = useDesktopWindowState();
  const desktopTitleBarMode = useSettings().desktopTitleBarMode;

  if (!isElectron) {
    return false;
  }

  if (!windowState) {
    return desktopTitleBarMode === "t3code";
  }

  if (windowState.platform === "other") {
    return false;
  }

  return windowState.titleBarMode === "t3code";
}
