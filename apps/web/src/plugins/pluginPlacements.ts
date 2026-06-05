import type {
  PluginCatalogEntry,
  PluginRouteContribution,
  PluginUiPlacementContribution,
  PluginUiPlacementPosition,
} from "@t3tools/contracts";

export interface PluginPlacementEntry {
  readonly catalogEntry: PluginCatalogEntry;
  readonly placement: PluginUiPlacementContribution;
  readonly route: PluginRouteContribution;
}

function comparePlacementEntries(left: PluginPlacementEntry, right: PluginPlacementEntry): number {
  return (
    (left.placement.order ?? Number.MAX_SAFE_INTEGER) -
      (right.placement.order ?? Number.MAX_SAFE_INTEGER) ||
    left.catalogEntry.manifest.name.localeCompare(right.catalogEntry.manifest.name) ||
    left.placement.label.localeCompare(right.placement.label) ||
    left.catalogEntry.manifest.id.localeCompare(right.catalogEntry.manifest.id) ||
    left.placement.id.localeCompare(right.placement.id)
  );
}

export function getActivePluginPlacementEntries(
  catalog: ReadonlyArray<PluginCatalogEntry>,
  position: PluginUiPlacementPosition,
): PluginPlacementEntry[] {
  return catalog
    .flatMap((catalogEntry) => {
      if (catalogEntry.status.status !== "active") {
        return [];
      }

      return catalogEntry.manifest.ui.placements.flatMap((placement) => {
        if (placement.position !== position) {
          return [];
        }

        const route = catalogEntry.manifest.routes.find(
          (candidate) => candidate.id === placement.routeId,
        );
        return route ? [{ catalogEntry, placement, route }] : [];
      });
    })
    .toSorted(comparePlacementEntries);
}

export function resolvePluginPlacementPath(entry: PluginPlacementEntry): string {
  const pluginId = encodeURIComponent(entry.catalogEntry.manifest.id);
  const routeId = encodeURIComponent(entry.placement.routeId);
  return entry.route.surface === "settings"
    ? `/settings/plugins/${pluginId}/${routeId}`
    : `/plugins/${pluginId}/${routeId}`;
}
