import { useEffect } from "react";

import { hydrateStoredSidebarPins } from "~/t3work/hooks/t3work-sidebarPinPersistence";
import { hydrateStoredSidebarNavPreferences } from "~/t3work/hooks/t3work-sidebarNavPreferencesPersistence";
import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import { useT3WorkSidebarNavPreferencesStore } from "~/t3work/t3work-sidebarNavPreferencesStore";

export function useHydratePinnedSidebarItems() {
  const hydratePins = useT3WorkPinnedSidebarStore((state) => state.hydrate);
  const hydrateNavPreferences = useT3WorkSidebarNavPreferencesStore((state) => state.hydrate);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      hydrateStoredSidebarPins(),
      hydrateStoredSidebarNavPreferences(),
    ]).then(([pinsResult, navPreferencesResult]) => {
      if (cancelled) {
        return;
      }

      hydratePins(pinsResult.status === "fulfilled" ? pinsResult.value : []);
      hydrateNavPreferences(
        navPreferencesResult.status === "fulfilled" ? navPreferencesResult.value : {},
      );
    });

    return () => {
      cancelled = true;
    };
  }, [hydrateNavPreferences, hydratePins]);
}
