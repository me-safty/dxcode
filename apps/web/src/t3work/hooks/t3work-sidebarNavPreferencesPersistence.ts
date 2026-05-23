import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";

import { readLocalApi } from "~/localApi";
import {
  normalizeSidebarNavPreferences,
  type T3WorkSidebarNavPreferences,
} from "~/t3work/t3work-sidebarNavPreferences";

function encodeSidebarNavPreferences(preferencesByProjectId: T3WorkSidebarNavPreferences): string {
  return JSON.stringify(normalizeSidebarNavPreferences(preferencesByProjectId));
}

function parseSidebarNavPreferences(raw: string | undefined): T3WorkSidebarNavPreferences {
  try {
    if (!raw) {
      return {};
    }

    return normalizeSidebarNavPreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function readStoredSidebarNavPreferencesFromClientSettings(
  settings: ClientSettings | null | undefined,
): T3WorkSidebarNavPreferences {
  return parseSidebarNavPreferences(settings?.t3workStoredSidebarNavPreferencesJson);
}

export async function hydrateStoredSidebarNavPreferences(): Promise<T3WorkSidebarNavPreferences> {
  const localApi = readLocalApi();
  if (!localApi) {
    return {};
  }

  try {
    const settings = await localApi.persistence.getClientSettings();
    const currentSettings = settings ?? DEFAULT_CLIENT_SETTINGS;
    const preferencesByProjectId = readStoredSidebarNavPreferencesFromClientSettings(settings);
    const nextJson = encodeSidebarNavPreferences(preferencesByProjectId);
    const currentJson = settings?.t3workStoredSidebarNavPreferencesJson ?? "";

    if (currentJson !== nextJson && (currentJson.length > 0 || nextJson.length > 2)) {
      await localApi.persistence.setClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...currentSettings,
        t3workStoredSidebarNavPreferencesJson: nextJson,
      });
    }

    return preferencesByProjectId;
  } catch {
    return {};
  }
}

export function persistStoredSidebarNavPreferences(
  preferencesByProjectId: T3WorkSidebarNavPreferences,
): void {
  const localApi = readLocalApi();
  if (!localApi) {
    return;
  }

  const nextJson = encodeSidebarNavPreferences(preferencesByProjectId);
  void localApi.persistence
    .getClientSettings()
    .then((settings) => {
      const currentSettings = settings ?? DEFAULT_CLIENT_SETTINGS;
      return localApi.persistence.setClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...currentSettings,
        t3workStoredSidebarNavPreferencesJson: nextJson,
      });
    })
    .catch(() => {
      // Ignore persistence failures and keep the optimistic renderer state.
    });
}
