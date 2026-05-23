import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";

import { readLocalApi } from "~/localApi";
import type { T3WorkSidebarPinnedItem } from "~/t3work/t3work-sidebarPinningTypes";

function dedupePinnedItems(
  items: ReadonlyArray<T3WorkSidebarPinnedItem>,
): T3WorkSidebarPinnedItem[] {
  const byId = new Map<string, T3WorkSidebarPinnedItem>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => right.pinnedAt.localeCompare(left.pinnedAt));
}

function encodePinnedItems(items: ReadonlyArray<T3WorkSidebarPinnedItem>): string {
  return JSON.stringify(dedupePinnedItems(items));
}

function parsePinnedItems(raw: string | undefined): T3WorkSidebarPinnedItem[] {
  try {
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupePinnedItems(parsed as T3WorkSidebarPinnedItem[]) : [];
  } catch {
    return [];
  }
}

export function readStoredSidebarPinsFromClientSettings(
  settings: ClientSettings | null | undefined,
): T3WorkSidebarPinnedItem[] {
  return parsePinnedItems(settings?.t3workStoredSidebarPinsJson);
}

export async function hydrateStoredSidebarPins(): Promise<T3WorkSidebarPinnedItem[]> {
  const localApi = readLocalApi();
  if (!localApi) {
    return [];
  }

  try {
    const settings = await localApi.persistence.getClientSettings();
    const currentSettings = settings ?? DEFAULT_CLIENT_SETTINGS;
    const pinnedItems = readStoredSidebarPinsFromClientSettings(settings);
    const nextJson = encodePinnedItems(pinnedItems);
    const currentJson = settings?.t3workStoredSidebarPinsJson ?? "";

    if (currentJson !== nextJson && (currentJson.length > 0 || pinnedItems.length > 0)) {
      await localApi.persistence.setClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...currentSettings,
        t3workStoredSidebarPinsJson: nextJson,
      });
    }

    return pinnedItems;
  } catch {
    return [];
  }
}

export function persistStoredSidebarPins(items: ReadonlyArray<T3WorkSidebarPinnedItem>): void {
  const localApi = readLocalApi();
  if (!localApi) {
    return;
  }

  const nextJson = encodePinnedItems(items);
  void localApi.persistence
    .getClientSettings()
    .then((settings) => {
      const currentSettings = settings ?? DEFAULT_CLIENT_SETTINGS;
      return localApi.persistence.setClientSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...currentSettings,
        t3workStoredSidebarPinsJson: nextJson,
      });
    })
    .catch(() => {
      // Ignore persistence failures and keep the optimistic renderer state.
    });
}
