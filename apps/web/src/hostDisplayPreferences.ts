import type { T3HostDisplayPreferences } from "@t3tools/contracts";
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

function emitDisplayPreferencesChanged(nextPreferences: T3HostDisplayPreferences): void {
  currentDisplayPreferences = normalizeDisplayPreferences(nextPreferences);
  for (const subscriber of subscribers) {
    subscriber();
  }
}

if (typeof window !== "undefined") {
  window.t3HostBridge?.onDisplayPreferencesChanged?.(emitDisplayPreferencesChanged);
}

function subscribeDisplayPreferences(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function readHostDisplayPreferences(): T3HostDisplayPreferences {
  return currentDisplayPreferences;
}

export function useHostDisplayPreferences(): T3HostDisplayPreferences {
  return useSyncExternalStore(
    subscribeDisplayPreferences,
    readHostDisplayPreferences,
    readHostDisplayPreferences,
  );
}
