import { type DesktopBridge, type DesktopRemoteState } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

function readDesktopRemoteBridge(): Pick<
  DesktopBridge,
  "getRemoteState" | "setRemoteEnabled" | "setRemoteToken" | "onRemoteState"
> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.desktopBridge;
  if (
    !bridge ||
    typeof bridge.getRemoteState !== "function" ||
    typeof bridge.setRemoteEnabled !== "function" ||
    typeof bridge.setRemoteToken !== "function" ||
    typeof bridge.onRemoteState !== "function"
  ) {
    return null;
  }

  return bridge;
}

export function useDesktopRemote() {
  const bridge = useMemo(() => readDesktopRemoteBridge(), []);
  const [state, setState] = useState<DesktopRemoteState | null>(null);
  const [isLoading, setIsLoading] = useState(() => bridge !== null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!bridge) {
      setState(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    const applyState = (nextState: DesktopRemoteState) => {
      if (!active) return;
      setState(nextState);
      setIsLoading(false);
    };

    void bridge
      .getRemoteState()
      .then(applyState)
      .catch(() => {
        if (!active) return;
        setIsLoading(false);
      });

    const unsubscribe = bridge.onRemoteState(applyState);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!bridge) {
        return null;
      }

      setIsSaving(true);
      try {
        const nextState = await bridge.setRemoteEnabled(enabled);
        setState(nextState);
        return nextState;
      } finally {
        setIsSaving(false);
      }
    },
    [bridge],
  );

  const setToken = useCallback(
    async (token: string) => {
      if (!bridge) {
        return null;
      }

      setIsSaving(true);
      try {
        const nextState = await bridge.setRemoteToken(token);
        setState(nextState);
        return nextState;
      } finally {
        setIsSaving(false);
      }
    },
    [bridge],
  );

  return {
    isSupported: bridge !== null,
    state,
    isLoading,
    isSaving,
    setEnabled,
    setToken,
  } as const;
}
