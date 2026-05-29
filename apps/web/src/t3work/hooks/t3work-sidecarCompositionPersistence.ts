import * as Schema from "effect/Schema";

import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  SidecarComposition as SidecarCompositionSchema,
  type SidecarComposition,
} from "@t3tools/project-recipes";

import { readLocalApi } from "~/localApi";
import { applySettingsUpdated, getServerConfig } from "~/rpc/serverState";

const SIDECAR_COMPOSITION_PERSISTENCE_ERROR_SCOPE = "[SIDECAR_COMPOSITION]";

const decodeSidecarComposition = Schema.decodeUnknownSync(SidecarCompositionSchema);
const EMPTY_SIDECAR_COMPOSITION: SidecarComposition = { sections: [] };

function normalizeSidecarComposition(composition: SidecarComposition): SidecarComposition {
  const sections = new Map<string, SidecarComposition["sections"][number]>();

  for (const section of composition.sections) {
    if (sections.has(section.sectionId)) {
      sections.delete(section.sectionId);
    }
    sections.set(section.sectionId, section);
  }

  return { sections: [...sections.values()] };
}

function encodeSidecarComposition(composition: SidecarComposition): string {
  return JSON.stringify(normalizeSidecarComposition(composition));
}

function parseSidecarComposition(raw: string | undefined): SidecarComposition {
  try {
    if (!raw) {
      return EMPTY_SIDECAR_COMPOSITION;
    }

    return normalizeSidecarComposition(decodeSidecarComposition(JSON.parse(raw)));
  } catch {
    return EMPTY_SIDECAR_COMPOSITION;
  }
}

export function readStoredSidecarCompositionFromClientSettings(
  settings: ClientSettings | null | undefined,
): SidecarComposition {
  return parseSidecarComposition(settings?.t3workStoredSidecarCompositionJson);
}

export function readStoredSidecarCompositionFromServerSettings(
  settings: Pick<ServerSettings, "t3workStoredSidecarCompositionJson"> | null | undefined,
): SidecarComposition {
  return parseSidecarComposition(settings?.t3workStoredSidecarCompositionJson);
}

export async function hydrateStoredSidecarComposition(): Promise<SidecarComposition> {
  const localApi = readLocalApi();
  if (!localApi) {
    return EMPTY_SIDECAR_COMPOSITION;
  }

  try {
    const serverSettings = await localApi.server.getSettings();
    const composition = readStoredSidecarCompositionFromServerSettings(serverSettings);
    const nextJson = encodeSidecarComposition(composition);
    const currentJson = serverSettings.t3workStoredSidecarCompositionJson ?? "";

    if (currentJson !== nextJson && (currentJson.length > 0 || composition.sections.length > 0)) {
      await localApi.server.updateSettings({
        t3workStoredSidecarCompositionJson: nextJson,
      });
    }

    return composition;
  } catch {
    return EMPTY_SIDECAR_COMPOSITION;
  }
}

let persistStoredSidecarCompositionQueue: Promise<void> = Promise.resolve();

function applyOptimisticServerSidecarComposition(nextJson: string): void {
  const currentServerConfig = getServerConfig();
  if (!currentServerConfig) {
    return;
  }

  applySettingsUpdated({
    ...currentServerConfig.settings,
    t3workStoredSidecarCompositionJson: nextJson,
  });
}

export function persistStoredSidecarComposition(composition: SidecarComposition): void {
  const localApi = readLocalApi();
  if (!localApi) {
    return;
  }

  const nextJson = encodeSidecarComposition(composition);
  applyOptimisticServerSidecarComposition(nextJson);
  persistStoredSidecarCompositionQueue = persistStoredSidecarCompositionQueue
    .catch(() => undefined)
    .then(async () => {
      await localApi.server.updateSettings({
        t3workStoredSidecarCompositionJson: nextJson,
      });
    })
    .catch((error) => {
      console.error(`${SIDECAR_COMPOSITION_PERSISTENCE_ERROR_SCOPE} persist failed`, error);
    });
}

export async function clearLegacyStoredSidecarComposition(): Promise<void> {
  const localApi = readLocalApi();
  if (!localApi) {
    return;
  }

  const currentClientSettings =
    (await localApi.persistence.getClientSettings()) ?? DEFAULT_CLIENT_SETTINGS;

  await localApi.persistence.setClientSettings({
    ...DEFAULT_CLIENT_SETTINGS,
    ...currentClientSettings,
    t3workStoredSidecarCompositionJson: "",
  });
}
