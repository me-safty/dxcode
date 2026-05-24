import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
    readonly defaultHost?: string;
    readonly defaultTailscaleServeEnabled?: boolean;
    readonly defaultTailscaleServePort?: number;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(flags, logLevel, options);
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
  });

export const runLocalServerCommand = (flags: CliServerFlags) =>
  runServerCommand(flags, {
    startupPresentation: "headless",
    forceAutoBootstrapProjectFromCwd: false,
    defaultHost: "127.0.0.1",
    defaultTailscaleServeEnabled: true,
    defaultTailscaleServePort: 443,
  });

export const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the Salchi server."),
  Command.withHandler((flags) => runServerCommand(flags)),
);

export const serveCommand = Command.make("serve", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run the Salchi server without opening a browser and print headless pairing details.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(flags, {
      startupPresentation: "headless",
      forceAutoBootstrapProjectFromCwd: false,
    }),
  ),
);

export const localCommand = Command.make("local", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run privately over HTTPS with Tailscale Serve and print pairing details.",
  ),
  Command.withHandler((flags) => runLocalServerCommand(flags)),
);
