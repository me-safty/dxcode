import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface CommandTrayButton {
  id: string;
  label: string;
  command: string;
  icon?: string;
}

interface CommandTrayState {
  buttons: CommandTrayButton[];
  setButtons: (buttons: CommandTrayButton[]) => void;
  addButton: (button: CommandTrayButton) => void;
  removeButton: (id: string) => void;
  updateButton: (id: string, updates: Partial<CommandTrayButton>) => void;
  resetToDefaults: () => void;
}

const DEFAULT_BUTTONS: CommandTrayButton[] = [
  { id: "update", label: "/update", command: "/update\n" },
  { id: "triage", label: "/triage", command: "/triage\n" },
  { id: "commit", label: "/commit", command: "/commit\n" },
  { id: "shell", label: "Shell", command: "" },
  { id: "claude", label: "Claude", command: "" },
];

const COMMAND_TRAY_STORAGE_KEY = "t3code:command-tray:v1";

export const useCommandTrayStore = create<CommandTrayState>()(
  persist(
    (set) => ({
      buttons: DEFAULT_BUTTONS,
      setButtons: (buttons) => set({ buttons }),
      addButton: (button) =>
        set((state) => ({ buttons: [...state.buttons, button] })),
      removeButton: (id) =>
        set((state) => ({
          buttons: state.buttons.filter((btn) => btn.id !== id),
        })),
      updateButton: (id, updates) =>
        set((state) => ({
          buttons: state.buttons.map((btn) =>
            btn.id === id ? { ...btn, ...updates } : btn,
          ),
        })),
      resetToDefaults: () => set({ buttons: DEFAULT_BUTTONS }),
    }),
    {
      name: COMMAND_TRAY_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ buttons: state.buttons }),
    },
  ),
);
