import { PluginId, PluginRouteId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { PluginRouteView } from "../plugins/pluginHost";

export const Route = createFileRoute("/plugins/$pluginId/$routeId")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: PluginRoute,
});

function PluginRoute() {
  const params = Route.useParams();
  return (
    <PluginRouteView
      pluginId={PluginId.make(params.pluginId)}
      routeId={PluginRouteId.make(params.routeId)}
      surface="app"
    />
  );
}
