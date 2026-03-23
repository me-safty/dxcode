import { create } from "zustand";

const STORAGE_KEY = "t3code:scratchpad:v1";

interface ScratchpadState {
  /** Map of projectId → scratchpad text */
  scratchpads: Record<string, string>;
  /** Get scratchpad text for a project */
  get: (projectId: string) => string;
  /** Set scratchpad text for a project */
  set: (projectId: string, text: string) => void;
  /** Clear scratchpad for a project */
  clear: (projectId: string) => void;
}

function loadFromStorage(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function saveToStorage(scratchpads: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scratchpads));
  } catch {
    // Silently fail if localStorage is full
  }
}

export const useScratchpadStore = create<ScratchpadState>((set, get) => ({
  scratchpads: loadFromStorage(),
  get: (projectId: string) => get().scratchpads[projectId] ?? "",
  set: (projectId: string, text: string) => {
    set((state) => {
      const updated = { ...state.scratchpads, [projectId]: text };
      saveToStorage(updated);
      return { scratchpads: updated };
    });
  },
  clear: (projectId: string) => {
    set((state) => {
      const updated = { ...state.scratchpads };
      delete updated[projectId];
      saveToStorage(updated);
      return { scratchpads: updated };
    });
  },
}));
