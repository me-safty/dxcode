import { createFileRoute, useLocation } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsGeneralRoute() {
  const location = useLocation();

  return (
    <GeneralSettingsPanel
      {...(location.hash === "providers" ? { initialScrollTarget: "providers" } : {})}
    />
  );
}

export const Route = createFileRoute("/settings/general")({
  component: SettingsGeneralRoute,
});
