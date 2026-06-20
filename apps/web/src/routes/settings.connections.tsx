import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ConnectionsSettings = lazy(() =>
  import("../components/settings/ConnectionsSettings").then((module) => ({
    default: module.ConnectionsSettings,
  })),
);

function ConnectionsSettingsRoute() {
  return (
    <Suspense fallback={null}>
      <ConnectionsSettings />
    </Suspense>
  );
}

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettingsRoute,
});
