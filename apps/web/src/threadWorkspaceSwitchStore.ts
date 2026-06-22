import { create } from "zustand";

interface ThreadWorkspaceSwitchState {
  readonly switchingThreadKeys: ReadonlySet<string>;
  readonly beginSwitch: (threadKey: string) => void;
  readonly endSwitch: (threadKey: string) => void;
}

const EMPTY_THREAD_KEYS = new Set<string>();

export const useThreadWorkspaceSwitchStore = create<ThreadWorkspaceSwitchState>((set) => ({
  switchingThreadKeys: EMPTY_THREAD_KEYS,
  beginSwitch: (threadKey) =>
    set((state) => {
      if (state.switchingThreadKeys.has(threadKey)) {
        return state;
      }
      const switchingThreadKeys = new Set(state.switchingThreadKeys);
      switchingThreadKeys.add(threadKey);
      return { switchingThreadKeys };
    }),
  endSwitch: (threadKey) =>
    set((state) => {
      if (!state.switchingThreadKeys.has(threadKey)) {
        return state;
      }
      const switchingThreadKeys = new Set(state.switchingThreadKeys);
      switchingThreadKeys.delete(threadKey);
      return {
        switchingThreadKeys:
          switchingThreadKeys.size === 0 ? EMPTY_THREAD_KEYS : switchingThreadKeys,
      };
    }),
}));
