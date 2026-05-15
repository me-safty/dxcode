import type { T3HostBridge, T3HostDisplayPreferences } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { isVscodeWebview } from "./env";

const DEFAULT_DISPLAY_PREFERENCES: T3HostDisplayPreferences = {
  showOpenInPicker: true,
  showCheckoutModeIndicator: true,
  showBranchSelector: true,
  enableTerminal: true,
};

const VSCODE_DISPLAY_PREFERENCES: T3HostDisplayPreferences = {
  showOpenInPicker: false,
  showCheckoutModeIndicator: false,
  showBranchSelector: false,
  enableTerminal: false,
};

export function resolveHostDisplayPreferences(input: {
  readonly isVscodeWebview: boolean;
  readonly preferences: Partial<T3HostDisplayPreferences> | null | undefined;
}): T3HostDisplayPreferences {
  const defaults = input.isVscodeWebview ? VSCODE_DISPLAY_PREFERENCES : DEFAULT_DISPLAY_PREFERENCES;
  const preferences = input.preferences;
  return {
    showOpenInPicker: preferences?.showOpenInPicker ?? defaults.showOpenInPicker,
    showCheckoutModeIndicator:
      preferences?.showCheckoutModeIndicator ?? defaults.showCheckoutModeIndicator,
    showBranchSelector: preferences?.showBranchSelector ?? defaults.showBranchSelector,
    enableTerminal: preferences?.enableTerminal ?? defaults.enableTerminal,
  };
}

function normalizeDisplayPreferences(
  preferences: Partial<T3HostDisplayPreferences> | null | undefined,
): T3HostDisplayPreferences {
  return resolveHostDisplayPreferences({ isVscodeWebview, preferences });
}

let currentDisplayPreferences = normalizeDisplayPreferences(
  typeof window === "undefined" ? null : window.t3HostBridge?.getDisplayPreferences?.(),
);

const subscribers = new Set<() => void>();
let subscribedHostBridge: T3HostBridge | null = null;
let unsubscribeDisplayPreferences: (() => void) | null = null;

function emitDisplayPreferencesChanged(nextPreferences: T3HostDisplayPreferences): void {
  currentDisplayPreferences = normalizeDisplayPreferences(nextPreferences);
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
  if (!bridge) {
    return;
  }

  currentDisplayPreferences = normalizeDisplayPreferences(bridge.getDisplayPreferences?.());
  unsubscribeDisplayPreferences =
    bridge.onDisplayPreferencesChanged?.(emitDisplayPreferencesChanged) ?? null;
}

if (typeof window !== "undefined") {
  ensureDisplayPreferencesBridgeSubscription();
}

function subscribeDisplayPreferences(callback: () => void): () => void {
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
    subscribeDisplayPreferences,
    readHostDisplayPreferences,
    readHostDisplayPreferences,
  );
}
