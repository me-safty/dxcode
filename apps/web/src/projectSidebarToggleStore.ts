/**
 * Bridges the left project sidebar's toggle out of its `SidebarProvider`.
 *
 * The project sidebar lives in `AppSidebarLayout`'s `SidebarProvider`, which is
 * an ancestor of the route outlet. Components rendered further down (notably
 * `ChatView`, which mounts its own right-dock `SidebarProvider`) cannot reach
 * that ancestor provider through `useSidebar`. So the layout registers its
 * toggle here and consumers invoke it, letting a keybinding toggle the project
 * sidebar from anywhere.
 */
import { create } from "zustand";

interface ProjectSidebarToggleState {
  toggle: (() => void) | null;
  setToggle: (toggle: (() => void) | null) => void;
}

export const useProjectSidebarToggleStore = create<ProjectSidebarToggleState>((set) => ({
  toggle: null,
  setToggle: (toggle) => set({ toggle }),
}));

/** Invoke the registered project sidebar toggle, if one is registered. */
export function toggleProjectSidebar(): void {
  useProjectSidebarToggleStore.getState().toggle?.();
}
