import { useEffect, useRef } from "react";

const DEFAULT_DEBOUNCE_MS = 250;

interface FocusRefreshWindow extends EventTarget {
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (timeoutId: number) => void;
}

interface FocusRefreshDocument extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

interface SubscribeWindowFocusRefreshOptions {
  readonly debounceMs?: number;
  readonly windowTarget?: FocusRefreshWindow | null;
  readonly documentTarget?: FocusRefreshDocument | null;
}

export function subscribeWindowFocusRefresh(
  refresh: () => void,
  options: SubscribeWindowFocusRefreshOptions = {},
): () => void {
  const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? null : window);
  const documentTarget =
    options.documentTarget ?? (typeof document === "undefined" ? null : document);
  if (!windowTarget || !documentTarget) return () => {};

  let refreshTimeout: number | null = null;
  const scheduleRefresh = () => {
    if (refreshTimeout !== null) windowTarget.clearTimeout(refreshTimeout);
    refreshTimeout = windowTarget.setTimeout(() => {
      refreshTimeout = null;
      refresh();
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  };
  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") scheduleRefresh();
  };

  windowTarget.addEventListener("focus", scheduleRefresh);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    if (refreshTimeout !== null) windowTarget.clearTimeout(refreshTimeout);
    windowTarget.removeEventListener("focus", scheduleRefresh);
    documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

export function useRefreshOnWindowFocus(refresh: () => void, enabled = true): void {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeWindowFocusRefresh(() => refreshRef.current());
  }, [enabled]);
}
