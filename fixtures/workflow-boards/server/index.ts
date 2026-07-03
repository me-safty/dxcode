import { definePlugin, type PluginRegistration } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";

import { migration001 } from "./migrations/001_WorkflowSchema.ts";

const toPluginError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export default definePlugin({
  register: (hostApi) =>
    Effect.gen(function* () {
      // Acquire the database capability so activation fails loudly if the
      // manifest ever drops the "database" declaration.
      yield* hostApi.database;
      const registration: PluginRegistration = {
        migrations: [migration001],
      };
      return registration;
    }).pipe(Effect.mapError(toPluginError)),
});
