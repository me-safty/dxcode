import { useCallback, useMemo } from "react";

import { useClientSettingsHydrated, useSettings, useUpdateSettings } from "./hooks/useSettings";

export function useDismissedProviderUpdateNotificationKeys() {
  const dismissedKeys = useSettings((settings) => settings.dismissedProviderUpdateNotificationKeys);
  const { updateSettings } = useUpdateSettings();
  const hydrated = useClientSettingsHydrated();

  const dismissedKeySet = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);

  const dismissNotificationKey = useCallback(
    (key: string) => {
      const trimmedKey = key.trim();
      if (trimmedKey.length === 0 || dismissedKeySet.has(trimmedKey)) {
        return;
      }

      updateSettings({
        dismissedProviderUpdateNotificationKeys: [...dismissedKeys, trimmedKey],
      });
    },
    [dismissedKeySet, dismissedKeys, updateSettings],
  );

  return {
    clientSettingsHydrated: hydrated,
    dismissedNotificationKeys: dismissedKeySet,
    dismissNotificationKey,
  };
}
