import { Command } from "effect/unstable/cli";

import { authCommand } from "./cli/auth.ts";
import { resolveServerConfig, sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";

export { resolveServerConfig };
export type { CliAuthLocationFlags, CliServerFlags } from "./cli/config.ts";

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([startCommand, serveCommand, authCommand, projectCommand]),
);
