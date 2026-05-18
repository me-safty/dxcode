export type T3workWorkMode = "classic" | "t3work";

export const T3WORK_WORK_MODE_STORAGE_KEY = "t3code.backendMode";

export function readT3workWorkMode(): T3workWorkMode {
  if (typeof window === "undefined") return "t3work";
  const value = window.localStorage.getItem(T3WORK_WORK_MODE_STORAGE_KEY);
  return value === "classic" ? "classic" : "t3work";
}

export function writeT3workWorkMode(mode: T3workWorkMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(T3WORK_WORK_MODE_STORAGE_KEY, mode);
}
