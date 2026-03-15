import type { DesktopWindowTitlebarState } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { isMacPlatform } from "../lib/utils";

export function getDefaultWindowTitlebarState({
  electron = isElectron,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
}: {
  electron?: boolean;
  platform?: string;
} = {}): DesktopWindowTitlebarState {
  return {
    trafficLightsVisible: electron && isMacPlatform(platform),
  };
}

const DEFAULT_SNAPSHOT = getDefaultWindowTitlebarState();

let snapshot = DEFAULT_SNAPSHOT;
let listeners: Array<() => void> = [];
let unsubscribeBridge: (() => void) | null = null;
let bridgeInitialized = false;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(nextSnapshot: DesktopWindowTitlebarState) {
  if (snapshot.trafficLightsVisible === nextSnapshot.trafficLightsVisible) {
    return;
  }

  snapshot = nextSnapshot;
  emitChange();
}

function ensureBridgeSubscription() {
  if (bridgeInitialized || !isElectron || typeof window === "undefined") {
    return;
  }

  bridgeInitialized = true;
  const bridge = window.desktopBridge;
  if (
    !bridge ||
    typeof bridge.getWindowTitlebarState !== "function" ||
    typeof bridge.onWindowTitlebarState !== "function"
  ) {
    return;
  }

  unsubscribeBridge = bridge.onWindowTitlebarState((nextSnapshot) => {
    setSnapshot(nextSnapshot);
  });

  void bridge
    .getWindowTitlebarState()
    .then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  ensureBridgeSubscription();

  return () => {
    listeners = listeners.filter((existingListener) => existingListener !== listener);
    if (listeners.length > 0) {
      return;
    }

    unsubscribeBridge?.();
    unsubscribeBridge = null;
    bridgeInitialized = false;
  };
}

function getSnapshot() {
  return snapshot;
}

export function useDesktopWindowTitlebarState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
