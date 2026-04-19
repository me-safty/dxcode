import { create } from "zustand";

export interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const EMPTY_SHORTCUT_MODIFIER_STATE: ShortcutModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

const useShortcutModifierStateStore = create<{
  state: ShortcutModifierState;
  setState: (state: ShortcutModifierState) => void;
  clear: () => void;
}>((set) => ({
  state: EMPTY_SHORTCUT_MODIFIER_STATE,
  setState: (state) => set({ state }),
  clear: () => set({ state: EMPTY_SHORTCUT_MODIFIER_STATE }),
}));

const useModelPickerOpenStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function useShortcutModifierState(): ShortcutModifierState {
  return useShortcutModifierStateStore((store) => store.state);
}

export function syncShortcutModifierStateFromKeyboardEvent(event: KeyboardEvent): void {
  useShortcutModifierStateStore.getState().setState({
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  });
}

export function setShortcutModifierState(state: ShortcutModifierState): void {
  useShortcutModifierStateStore.getState().setState(state);
}

export function clearShortcutModifierState(): void {
  useShortcutModifierStateStore.getState().clear();
}

export function readShortcutModifierState(): ShortcutModifierState {
  return useShortcutModifierStateStore.getState().state;
}

export function useModelPickerOpen(): boolean {
  return useModelPickerOpenStore((store) => store.open);
}

export function setModelPickerOpen(open: boolean): void {
  useModelPickerOpenStore.getState().setOpen(open);
}
