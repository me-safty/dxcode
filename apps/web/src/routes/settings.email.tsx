import { createFileRoute } from "@tanstack/react-router";

import { EmailSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsEmailRoute() {
  return <EmailSettingsPanel />;
}

export const Route = createFileRoute("/settings/email")({
  component: SettingsEmailRoute,
});
