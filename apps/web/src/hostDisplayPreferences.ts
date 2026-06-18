import type { T3HostBridge, T3HostDisplayPreferences } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { isVscodeWebview } from "./env";

const DEFAULT_DISPLAY_PREFERENCES: T3HostDisplayPreferences = {
  enableSourceControlPanel: true,
};

const VSCODE_DISPLAY_PREFERENCES: T3HostDisplayPreferences = {
  enableSourceControlPanel: false,
};

function normalizeDisplayPreferences(
  preferences: Partial<T3HostDisplayPreferences> | null | undefined,
): T3HostDisplayPreferences {
  const defaults = isVscodeWebview ? VSCODE_DISPLAY_PREFERENCES : DEFAULT_DISPLAY_PREFERENCES;
  return {
    enableSourceControlPanel:
      preferences?.enableSourceControlPanel ?? defaults.enableSourceControlPanel,
  };
}

function areDisplayPreferencesEqual(
  left: T3HostDisplayPreferences,
  right: T3HostDisplayPreferences,
): boolean {
  return left.enableSourceControlPanel === right.enableSourceControlPanel;
}

let currentDisplayPreferences = normalizeDisplayPreferences(
  typeof window === "undefined" ? null : window.t3HostBridge?.getDisplayPreferences?.(),
);

const subscribers = new Set<() => void>();
let subscribedHostBridge: T3HostBridge | null = null;
let unsubscribeDisplayPreferences: (() => void) | null = null;

function setDisplayPreferences(
  nextPreferences: Partial<T3HostDisplayPreferences> | null | undefined,
): void {
  const normalizedPreferences = normalizeDisplayPreferences(nextPreferences);
  if (areDisplayPreferencesEqual(currentDisplayPreferences, normalizedPreferences)) {
    return;
  }

  currentDisplayPreferences = normalizedPreferences;
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function ensureDisplayPreferencesBridgeSubscription(): void {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.t3HostBridge ?? null;
  if (bridge === subscribedHostBridge) {
    return;
  }

  unsubscribeDisplayPreferences?.();
  subscribedHostBridge = bridge;
  unsubscribeDisplayPreferences = null;
  setDisplayPreferences(bridge?.getDisplayPreferences?.() ?? null);
  if (!bridge) {
    return;
  }

  unsubscribeDisplayPreferences =
    bridge.onDisplayPreferencesChanged?.((preferences) => setDisplayPreferences(preferences)) ??
    null;
}

if (typeof window !== "undefined") {
  ensureDisplayPreferencesBridgeSubscription();
}

export function subscribeHostDisplayPreferences(callback: () => void): () => void {
  ensureDisplayPreferencesBridgeSubscription();
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function readHostDisplayPreferences(): T3HostDisplayPreferences {
  ensureDisplayPreferencesBridgeSubscription();
  return currentDisplayPreferences;
}

export function useHostDisplayPreferences(): T3HostDisplayPreferences {
  return useSyncExternalStore(
    subscribeHostDisplayPreferences,
    readHostDisplayPreferences,
    readHostDisplayPreferences,
  );
}
