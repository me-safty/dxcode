import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { type ClientSettings, type DesktopZoomState } from "@t3tools/contracts";
import { ClientSettingsSchema } from "@t3tools/contracts/settings";
import {
  clampWindowZoomLevel,
  zoomLevelToPercent,
  zoomLevelToZoomFactor,
} from "@t3tools/shared/zoom";
import { useSettings, useUpdateSettings, CLIENT_SETTINGS_STORAGE_KEY } from "./useSettings";
import { getLocalStorageItem } from "./useLocalStorage";

const INDICATOR_DURATION_MS = 750;

type WindowZoomSnapshot = {
  zoomLevel: number;
  zoomFactor: number;
  zoomPercent: number;
  indicatorVisible: boolean;
  indicatorMessage: string;
  announcementToken: number;
};

let snapshot: WindowZoomSnapshot = {
  zoomLevel: 0,
  zoomFactor: zoomLevelToZoomFactor(0),
  zoomPercent: zoomLevelToPercent(0),
  indicatorVisible: false,
  indicatorMessage: "",
  announcementToken: 0,
};

let indicatorTimer: number | null = null;
let lastAppliedZoomLevel: number | null = null;
let committedPersistedZoomLevel = 0;
let pendingPersistedZoomLevel: number | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function getWindowZoomSnapshot(): WindowZoomSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setSnapshot(nextSnapshot: WindowZoomSnapshot) {
  snapshot = nextSnapshot;
  emitChange();
}

function replaceSnapshot(next: Partial<WindowZoomSnapshot>) {
  setSnapshot({ ...snapshot, ...next });
}

function applySnapshotFromLevel(level: number) {
  const clampedLevel = clampWindowZoomLevel(level);
  replaceSnapshot({
    zoomLevel: clampedLevel,
    zoomFactor: zoomLevelToZoomFactor(clampedLevel),
    zoomPercent: zoomLevelToPercent(clampedLevel),
  });
}

function applySnapshotFromDesktopState(state: DesktopZoomState) {
  const level = clampWindowZoomLevel(state.level);
  const factor = Number.isFinite(state.factor) ? state.factor : zoomLevelToZoomFactor(level);
  const percent = Number.isFinite(state.percent) ? state.percent : zoomLevelToPercent(level);

  replaceSnapshot({
    zoomLevel: level,
    zoomFactor: factor,
    zoomPercent: percent,
  });
}

function showIndicator(zoomPercent: number) {
  if (typeof window !== "undefined" && indicatorTimer !== null) {
    window.clearTimeout(indicatorTimer);
  }

  replaceSnapshot({
    indicatorVisible: true,
    indicatorMessage: `UI scale ${zoomPercent}%`,
    announcementToken: snapshot.announcementToken + 1,
  });

  if (typeof window === "undefined") {
    return;
  }

  indicatorTimer = window.setTimeout(() => {
    indicatorTimer = null;
    replaceSnapshot({ indicatorVisible: false });
  }, INDICATOR_DURATION_MS);
}

function applyBrowserZoom(level: number) {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  document.body.style.zoom = String(zoomLevelToZoomFactor(level));
}

function readPersistedWindowZoomLevel() {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const settings = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
    return clampWindowZoomLevel(settings?.windowZoomLevel ?? 0);
  } catch {
    return 0;
  }
}

function requestPersistedWindowZoomLevel(
  level: number,
  updateSettings: (patch: { windowZoomLevel: number }) => void,
) {
  const clampedLevel = clampWindowZoomLevel(level);
  if (pendingPersistedZoomLevel === clampedLevel) {
    return false;
  }

  if (pendingPersistedZoomLevel === null && committedPersistedZoomLevel === clampedLevel) {
    return false;
  }

  pendingPersistedZoomLevel = clampedLevel;
  updateSettings({ windowZoomLevel: clampedLevel });
  return true;
}

function applyDesktopZoom(level: number) {
  const state = window.desktopBridge?.setZoomLevel(level);
  if (!state) {
    return null;
  }

  applySnapshotFromDesktopState(state);
  const nextLevel = clampWindowZoomLevel(state.level);
  lastAppliedZoomLevel = nextLevel;
  return nextLevel;
}

export function applyInitialWindowZoom() {
  const zoomLevel = readPersistedWindowZoomLevel();
  applySnapshotFromLevel(zoomLevel);
  lastAppliedZoomLevel = zoomLevel;
  committedPersistedZoomLevel = zoomLevel;
  pendingPersistedZoomLevel = null;

  if (window.desktopBridge?.setZoomLevel) {
    try {
      applyDesktopZoom(zoomLevel);
    } catch {
      applySnapshotFromLevel(zoomLevel);
      lastAppliedZoomLevel = zoomLevel;
    }
    return;
  }

  applyBrowserZoom(zoomLevel);
}

function applyWindowZoomLevel(level: number, showZoomIndicator: boolean) {
  const clampedLevel = clampWindowZoomLevel(level);
  const desktopBridge = window.desktopBridge;

  if (desktopBridge?.setZoomLevel) {
    let nextLevel = clampedLevel;

    try {
      nextLevel = applyDesktopZoom(clampedLevel) ?? clampedLevel;
    } catch (error) {
      applySnapshotFromLevel(clampedLevel);
      lastAppliedZoomLevel = clampedLevel;
      if (showZoomIndicator) {
        showIndicator(zoomLevelToPercent(clampedLevel));
      }
      throw error;
    }

    if (showZoomIndicator) {
      showIndicator(getWindowZoomSnapshot().zoomPercent);
    }
    return nextLevel;
  }

  applyBrowserZoom(clampedLevel);
  applySnapshotFromLevel(clampedLevel);
  lastAppliedZoomLevel = clampedLevel;
  if (showZoomIndicator) {
    showIndicator(zoomLevelToPercent(clampedLevel));
  }
  return clampedLevel;
}

function syncPersistedWindowZoomLevel(level: number) {
  const clampedLevel = clampWindowZoomLevel(level);

  if (pendingPersistedZoomLevel !== null) {
    if (clampedLevel !== pendingPersistedZoomLevel) {
      return false;
    }
    pendingPersistedZoomLevel = null;
  }

  committedPersistedZoomLevel = clampedLevel;

  if (lastAppliedZoomLevel === clampedLevel) {
    return true;
  }

  try {
    applyWindowZoomLevel(clampedLevel, false);
  } catch {
    applySnapshotFromLevel(clampedLevel);
    lastAppliedZoomLevel = clampedLevel;
  }

  return true;
}

type SetZoomLevelOptions = {
  showIndicator?: boolean;
};

export function useWindowZoom() {
  const storedZoomLevel = useSettings((settings) => settings.windowZoomLevel);
  const { updateSettings } = useUpdateSettings();
  const currentSnapshot = useSyncExternalStore(
    subscribe,
    getWindowZoomSnapshot,
    getWindowZoomSnapshot,
  );

  useEffect(() => {
    syncPersistedWindowZoomLevel(storedZoomLevel);
  }, [storedZoomLevel]);

  const setZoomLevel = useCallback(
    async (level: number, options?: SetZoomLevelOptions) => {
      const nextLevel = applyWindowZoomLevel(level, options?.showIndicator ?? true);
      requestPersistedWindowZoomLevel(nextLevel, updateSettings);
      return nextLevel;
    },
    [updateSettings],
  );

  const zoomIn = useCallback(() => {
    return setZoomLevel(getWindowZoomSnapshot().zoomLevel + 1);
  }, [setZoomLevel]);

  const zoomOut = useCallback(() => {
    return setZoomLevel(getWindowZoomSnapshot().zoomLevel - 1);
  }, [setZoomLevel]);

  const resetZoom = useCallback(() => {
    return setZoomLevel(0);
  }, [setZoomLevel]);

  return useMemo(
    () => ({
      ...currentSnapshot,
      setZoomLevel,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [currentSnapshot, resetZoom, setZoomLevel, zoomIn, zoomOut],
  );
}

export function readPersistedClientZoomSettings(): ClientSettings | null {
  try {
    return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
  } catch {
    return null;
  }
}

export async function __applyWindowZoomLevelForTests(level: number, showIndicator = true) {
  return applyWindowZoomLevel(level, showIndicator);
}

export function __requestPersistedWindowZoomLevelForTests(level: number) {
  return requestPersistedWindowZoomLevel(level, () => undefined);
}

export function __syncPersistedWindowZoomLevelForTests(level: number) {
  return syncPersistedWindowZoomLevel(level);
}

export function __getWindowZoomSnapshotForTests() {
  return getWindowZoomSnapshot();
}

export function __resetWindowZoomForTests() {
  if (typeof window !== "undefined" && indicatorTimer !== null) {
    window.clearTimeout(indicatorTimer);
  }
  indicatorTimer = null;
  snapshot = {
    zoomLevel: 0,
    zoomFactor: zoomLevelToZoomFactor(0),
    zoomPercent: zoomLevelToPercent(0),
    indicatorVisible: false,
    indicatorMessage: "",
    announcementToken: 0,
  };
  lastAppliedZoomLevel = null;
  committedPersistedZoomLevel = 0;
  pendingPersistedZoomLevel = null;
  listeners.clear();
}
