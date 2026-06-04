import type { T3PluginHostGlobal } from "@t3tools/plugin-api/ui";

import { AUTOMATIONS_PLUGIN_ID } from "../shared/constants.ts";
import { AutomationsPage } from "./AutomationsPage.tsx";

declare global {
  interface Window {
    readonly T3PluginHost?: T3PluginHostGlobal;
  }
}

const host = window.T3PluginHost;
if (!host) {
  throw new Error("T3PluginHost is not available.");
}

host.register(AUTOMATIONS_PLUGIN_ID, (ctx) => ({
  routes: {
    main: () => {
      const React = ctx.react;
      void React;
      return <AutomationsPage ctx={ctx} />;
    },
  },
}));
