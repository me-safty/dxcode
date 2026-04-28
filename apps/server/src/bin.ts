import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Sentry from "@sentry/node";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli.ts";
import packageJson from "../package.json" with { type: "json" };

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

Command.run(cli, { version: packageJson.version }).pipe(
  // Effect's runMain reports fatal failures via its own logger and exits, which
  // bypasses Sentry's uncaughtException/unhandledRejection integrations. Bridge
  // the Cause into Sentry and flush before the process exits.
  Effect.tapCause((cause) =>
    Effect.promise(async () => {
      Sentry.captureException(Cause.squash(cause));
      await Sentry.flush(2000);
    }),
  ),
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
  NodeRuntime.runMain,
);
