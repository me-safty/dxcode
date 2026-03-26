import type { DesktopWindowState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

export function useDesktopWindowState(): DesktopWindowState | null {
  const [windowState, setWindowState] = useState<DesktopWindowState | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      setWindowState(null);
      return;
    }

    let cancelled = false;

    void bridge.getWindowState().then((nextState) => {
      if (!cancelled) {
        setWindowState(nextState);
      }
    });

    const unsubscribe = bridge.onWindowState((nextState) => {
      if (!cancelled) {
        setWindowState(nextState);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return windowState;
}
