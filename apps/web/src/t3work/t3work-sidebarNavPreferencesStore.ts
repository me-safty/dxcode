import { create } from "zustand";

import { persistStoredSidebarNavPreferences } from "~/t3work/hooks/t3work-sidebarNavPreferencesPersistence";
import {
  getSidebarNavProjectState,
  normalizeSidebarNavPreferences,
  normalizeSidebarNavProjectState,
  type T3WorkSidebarNavPreferences,
} from "~/t3work/t3work-sidebarNavPreferences";

type T3WorkSidebarNavPreferencesState = {
  hydrated: boolean;
  preferencesByProjectId: T3WorkSidebarNavPreferences;
  hydrate: (preferencesByProjectId: T3WorkSidebarNavPreferences) => void;
  hideItem: (projectId: string, itemId: string) => void;
  showItem: (projectId: string, itemId: string) => void;
  setOrderedItemIds: (projectId: string, itemIds: ReadonlyArray<string>) => void;
};

function updateProjectState(
  preferencesByProjectId: T3WorkSidebarNavPreferences,
  projectId: string,
  update: (
    projectState: ReturnType<typeof normalizeSidebarNavProjectState>,
  ) => ReturnType<typeof normalizeSidebarNavProjectState>,
): T3WorkSidebarNavPreferences {
  const currentProjectState = getSidebarNavProjectState(preferencesByProjectId, projectId);
  return {
    ...preferencesByProjectId,
    [projectId]: update(currentProjectState),
  };
}

export const useT3WorkSidebarNavPreferencesStore = create<T3WorkSidebarNavPreferencesState>(
  (set, get) => ({
    hydrated: false,
    preferencesByProjectId: {},
    hydrate: (preferencesByProjectId) => {
      set({
        hydrated: true,
        preferencesByProjectId: normalizeSidebarNavPreferences(preferencesByProjectId),
      });
    },
    hideItem: (projectId, itemId) => {
      const current = get().preferencesByProjectId;
      const projectState = getSidebarNavProjectState(current, projectId);
      if (projectState.hiddenItemIds.includes(itemId)) {
        return;
      }

      const next = updateProjectState(current, projectId, (state) =>
        normalizeSidebarNavProjectState({
          ...state,
          hiddenItemIds: [...state.hiddenItemIds, itemId],
        }),
      );
      set({ preferencesByProjectId: next });
      persistStoredSidebarNavPreferences(next);
    },
    showItem: (projectId, itemId) => {
      const current = get().preferencesByProjectId;
      const projectState = getSidebarNavProjectState(current, projectId);
      if (!projectState.hiddenItemIds.includes(itemId)) {
        return;
      }

      const next = updateProjectState(current, projectId, (state) =>
        normalizeSidebarNavProjectState({
          ...state,
          hiddenItemIds: state.hiddenItemIds.filter((candidate) => candidate !== itemId),
        }),
      );
      set({ preferencesByProjectId: next });
      persistStoredSidebarNavPreferences(next);
    },
    setOrderedItemIds: (projectId, itemIds) => {
      const current = get().preferencesByProjectId;
      const next = updateProjectState(current, projectId, (state) =>
        normalizeSidebarNavProjectState({
          ...state,
          orderedItemIds: [...itemIds],
        }),
      );
      set({ preferencesByProjectId: next });
      persistStoredSidebarNavPreferences(next);
    },
  }),
);
