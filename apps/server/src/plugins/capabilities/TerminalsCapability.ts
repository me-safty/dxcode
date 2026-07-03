import type { PluginId } from "@t3tools/contracts/plugin";
import type { TerminalSessionHandle, TerminalsCapability } from "@t3tools/plugin-sdk";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import * as TerminalManager from "../../terminal/Manager.ts";

const quoteShellArg = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const commandLine = (command: string, args: ReadonlyArray<string> | undefined) =>
  [command, ...(args ?? [])].map(quoteShellArg).join(" ");

const defaultHandle = (pluginId: PluginId, terminalId: string): TerminalSessionHandle => ({
  threadId: `plugin:${pluginId}:${terminalId}`,
  terminalId,
});

export function makeTerminalsCapability(input: {
  readonly pluginId: PluginId;
  readonly manager: TerminalManager.TerminalManager["Service"];
}): TerminalsCapability {
  return {
    spawn: (request) =>
      Effect.gen(function* () {
        const terminalId =
          request.terminalId ??
          `run-${yield* Clock.currentTimeMillis}-${(yield* Random.nextInt).toString(36)}`;
        const handle = defaultHandle(input.pluginId, terminalId);
        const snapshot = yield* input.manager.open({
          ...handle,
          cwd: request.cwd,
          ...(request.env === undefined ? {} : { env: request.env }),
          cols: request.cols ?? 120,
          rows: request.rows ?? 30,
        });
        yield* input.manager.write({
          ...handle,
          data: `${commandLine(request.command, request.args)}\n`,
        });
        return { handle, snapshot };
      }),
    observe: (handle, listener) =>
      input.manager.attachStream(
        {
          ...handle,
          restartIfNotRunning: false,
        },
        listener,
      ),
    sendInput: (request) => input.manager.write(request),
    kill: (request) =>
      input.manager.close({
        threadId: request.threadId,
        terminalId: request.terminalId,
        ...(request.deleteHistory === undefined ? {} : { deleteHistory: request.deleteHistory }),
      }),
  };
}
