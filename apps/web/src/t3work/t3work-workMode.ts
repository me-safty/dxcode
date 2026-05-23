import { useSyncExternalStore } from "react";

export type T3workWorkMode = "classic" | "t3work";

export const T3WORK_WORK_MODE_STORAGE_KEY = "t3code.backendMode";
export const T3WORK_WORK_MODE_CHANGED_EVENT = "t3code:work-mode-changed";

export function readT3workWorkMode(): T3workWorkMode {
  if (typeof window === "undefined") return "t3work";
  const value = window.localStorage.getItem(T3WORK_WORK_MODE_STORAGE_KEY);
  return value === "classic" ? "classic" : "t3work";
}

export function writeT3workWorkMode(mode: T3workWorkMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(T3WORK_WORK_MODE_STORAGE_KEY, mode);
  window.dispatchEvent?.(
    new CustomEvent<T3workWorkMode>(T3WORK_WORK_MODE_CHANGED_EVENT, { detail: mode }),
  );
}

export function subscribeT3workWorkMode(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {
      // No-op outside the browser runtime.
    };
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === T3WORK_WORK_MODE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  const onModeChanged = () => {
    onStoreChange();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(T3WORK_WORK_MODE_CHANGED_EVENT, onModeChanged);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(T3WORK_WORK_MODE_CHANGED_EVENT, onModeChanged);
  };
}

export function useT3workWorkMode(): T3workWorkMode {
  return useSyncExternalStore(subscribeT3workWorkMode, readT3workWorkMode, () => "t3work");
}
