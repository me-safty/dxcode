import { PluginId, PluginRouteId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { PluginRouteView } from "../plugins/pluginHost";

export const Route = createFileRoute("/settings/plugins/$pluginId/$routeId")({
  component: SettingsPluginRoute,
});

function SettingsPluginRoute() {
  const params = Route.useParams();
  return (
    <PluginRouteView
      pluginId={PluginId.make(params.pluginId)}
      routeId={PluginRouteId.make(params.routeId)}
      surface="settings"
    />
  );
}
