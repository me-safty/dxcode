import {
  PluginId,
  PluginRouteId,
  PluginUiPlacementId,
  type PluginCatalogEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getActivePluginPlacementEntries, resolvePluginPlacementPath } from "./pluginPlacements";

function catalogEntry(input: {
  readonly pluginId: string;
  readonly name: string;
  readonly routeId?: string;
  readonly routeSurface?: "app" | "settings";
  readonly placementId: string;
  readonly placementLabel: string;
  readonly placementPosition:
    | "sidebar.primary"
    | "sidebar.footer"
    | "settings.sidebar"
    | "commandPalette.actions";
  readonly order?: number;
  readonly status?: "active" | "failed" | "disabled";
}): PluginCatalogEntry {
  const pluginId = PluginId.make(input.pluginId);
  const routeId = PluginRouteId.make(input.routeId ?? "main");
  return {
    manifest: {
      id: pluginId,
      name: input.name,
      version: "0.1.0",
      routes: [
        {
          id: routeId,
          label: input.name,
          surface: input.routeSurface ?? "app",
        },
      ],
      ui: {
        placements: [
          {
            id: PluginUiPlacementId.make(input.placementId),
            position: input.placementPosition,
            label: input.placementLabel,
            routeId,
            ...(input.order !== undefined ? { order: input.order } : {}),
          },
        ],
      },
      commands: [],
    },
    status: {
      pluginId,
      status: input.status ?? "active",
    },
    assets: {
      client: `/plugins/assets/${pluginId}/client.js`,
    },
  };
}

describe("pluginPlacements", () => {
  it("filters active placements by fixed position and applies stable ordering", () => {
    const entries = getActivePluginPlacementEntries(
      [
        catalogEntry({
          pluginId: "t3.zeta",
          name: "Zeta",
          placementId: "main",
          placementLabel: "Zeta",
          placementPosition: "sidebar.primary",
          order: 2,
        }),
        catalogEntry({
          pluginId: "t3.alpha",
          name: "Alpha",
          placementId: "main",
          placementLabel: "Alpha",
          placementPosition: "sidebar.primary",
          order: 1,
        }),
        catalogEntry({
          pluginId: "t3.footer",
          name: "Footer",
          placementId: "main",
          placementLabel: "Footer",
          placementPosition: "sidebar.footer",
          order: 0,
        }),
        catalogEntry({
          pluginId: "t3.failed",
          name: "Failed",
          placementId: "main",
          placementLabel: "Failed",
          placementPosition: "sidebar.primary",
          status: "failed",
        }),
      ],
      "sidebar.primary",
    );

    expect(entries.map((entry) => entry.catalogEntry.manifest.id)).toEqual(["t3.alpha", "t3.zeta"]);
  });

  it("resolves app and settings placement paths", () => {
    const [appEntry] = getActivePluginPlacementEntries(
      [
        catalogEntry({
          pluginId: "t3.app",
          name: "App",
          placementId: "main",
          placementLabel: "App",
          placementPosition: "commandPalette.actions",
          routeSurface: "app",
        }),
      ],
      "commandPalette.actions",
    );
    const [settingsEntry] = getActivePluginPlacementEntries(
      [
        catalogEntry({
          pluginId: "t3.settings",
          name: "Settings",
          placementId: "settings",
          placementLabel: "Settings",
          placementPosition: "settings.sidebar",
          routeId: "settings",
          routeSurface: "settings",
        }),
      ],
      "settings.sidebar",
    );

    expect(appEntry ? resolvePluginPlacementPath(appEntry) : null).toBe("/plugins/t3.app/main");
    expect(settingsEntry ? resolvePluginPlacementPath(settingsEntry) : null).toBe(
      "/settings/plugins/t3.settings/settings",
    );
  });
});
