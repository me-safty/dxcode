import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import * as NetService from "@t3tools/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { authCommand } from "./cli/auth.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import {
  localCommand,
  runLocalServerCommand,
  runServerCommand,
  serveCommand,
  startCommand,
} from "./cli/server.ts";

export const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([startCommand, serveCommand, localCommand, authCommand, projectCommand]),
);

export const t3localCli = Command.make("t3local", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run T3 Code privately over HTTPS with Tailscale Serve."),
  Command.withHandler((flags) => runLocalServerCommand(flags)),
);

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
