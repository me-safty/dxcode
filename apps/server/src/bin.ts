import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import * as NetService from "@t3tools/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { authCommand } from "./cli/auth.ts";
import { connectCommand } from "./cli/connect.ts";
import { hasCloudPublicConfig } from "./cloud/publicConfig.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";
import { LaunchEnv } from "./launchEnv/Services/LaunchEnv.ts";
import { LaunchEnvThreadLookupError } from "./launchEnv/Services/LaunchEnvErrors.ts";
import { TerminalManager, TerminalSessionLookupError } from "./terminal/Services/Manager.ts";

const terminalManagerStub = {
  open: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  attachStream: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  write: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  resize: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  clear: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  restart: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  close: () => Effect.fail(new TerminalSessionLookupError({ threadId: "", terminalId: "" })),
  subscribe: () => Effect.succeed(() => {}),
  subscribeMetadata: () => Effect.succeed(() => {}),
};

const launchEnvStub = {
  resolve: () => Effect.succeed({} as Record<string, string>),
  resolveForThread: () =>
    Effect.fail(
      new LaunchEnvThreadLookupError({
        threadId: "",
        terminalId: "",
      }),
    ),
};

const CliRuntimeLayer = Layer.mergeAll(
  NodeServices.layer,
  NetService.layer,
  Layer.succeed(TerminalManager, terminalManagerStub),
  Layer.succeed(LaunchEnv, launchEnvStub),
);

const connectPublicConfigMissingMessage =
  "T3 Connect commands are unavailable: this build is missing T3 Connect public configuration.";

class ConnectPublicConfigMissingError extends CliError.UserError {
  override get message() {
    return connectPublicConfigMissingMessage;
  }
}

const connectUnavailableCommand = Command.make("connect").pipe(
  Command.withDescription("T3 Connect is unavailable in builds without public configuration."),
  Command.withHidden,
  Command.withHandler(() =>
    Effect.fail(
      new CliError.ShowHelp({
        commandPath: ["t3", "connect"],
        errors: [new ConnectPublicConfigMissingError({ cause: connectPublicConfigMissingMessage })],
      }),
    ),
  ),
);

export const makeCli = ({ cloudEnabled = hasCloudPublicConfig } = {}) =>
  Command.make("t3", { ...sharedServerCommandFlags }).pipe(
    Command.withDescription("Run the T3 Code server."),
    Command.withHandler((flags) => runServerCommand(flags)),
    Command.withSubcommands([
      startCommand,
      serveCommand,
      authCommand,
      projectCommand,
      cloudEnabled ? connectCommand : connectUnavailableCommand,
    ]),
  );

export const cli = makeCli();

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
