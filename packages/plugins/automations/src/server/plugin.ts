import { PluginId } from "@t3tools/plugin-api/schema";
import { defineServerPlugin } from "@t3tools/plugin-api/server";
import * as Effect from "effect/Effect";

import { AUTOMATIONS_COMMANDS, AUTOMATIONS_PLUGIN_ID } from "../shared/constants.ts";
import { AutomationRule, AutomationRun } from "../shared/schema.ts";
import { commandName, registerAutomationCommands } from "./commands.ts";
import {
  PLACEMENT_MAIN_SIDEBAR,
  ROUTE_MAIN,
  RULES_COLLECTION,
  RUNS_COLLECTION,
  SCHEDULE_STATE_COLLECTION,
} from "./constants.ts";
import { makeAutomationsRuntime, startAutomationScheduleLoop } from "./runtime.ts";
import { AutomationScheduleState } from "./schedule.ts";

const pluginId = PluginId.make(AUTOMATIONS_PLUGIN_ID);

export const automationsPlugin = defineServerPlugin({
  manifest: {
    id: pluginId,
    name: "Automations",
    version: "0.1.0",
    routes: [
      {
        id: ROUTE_MAIN,
        label: "Automations",
        surface: "app",
      },
    ],
    ui: {
      placements: [
        {
          id: PLACEMENT_MAIN_SIDEBAR,
          position: "sidebar.primary",
          label: "Automations",
          routeId: ROUTE_MAIN,
          order: 100,
        },
      ],
    },
    commands: [
      {
        name: commandName(AUTOMATIONS_COMMANDS.rulesList),
        label: "List automation rules",
      },
      {
        name: commandName(AUTOMATIONS_COMMANDS.rulesCreate),
        label: "Create automation rule",
      },
      {
        name: commandName(AUTOMATIONS_COMMANDS.rulesUpdate),
        label: "Update automation rule",
      },
      {
        name: commandName(AUTOMATIONS_COMMANDS.rulesDelete),
        label: "Delete automation rule",
      },
      {
        name: commandName(AUTOMATIONS_COMMANDS.rulesRunNow),
        label: "Run automation rule now",
      },
      {
        name: commandName(AUTOMATIONS_COMMANDS.runsListRecent),
        label: "List automation runs",
      },
    ],
  },
  activate: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.store.registerCollection(RULES_COLLECTION, AutomationRule);
      yield* ctx.store.registerCollection(RUNS_COLLECTION, AutomationRun);
      yield* ctx.store.registerCollection(SCHEDULE_STATE_COLLECTION, AutomationScheduleState);

      const runtime = yield* makeAutomationsRuntime(ctx);
      yield* runtime.markInterruptedRunsFailed;
      yield* startAutomationScheduleLoop(runtime);

      yield* ctx.ui.setPlacementBadgeProvider(
        PLACEMENT_MAIN_SIDEBAR,
        runtime.countFailedOrSkippedRuns,
      );
      yield* registerAutomationCommands(ctx, runtime);
    }),
});
