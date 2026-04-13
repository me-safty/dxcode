import * as child_process from "node:child_process";
import { createRequire } from "node:module";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli";
import { version } from "../package.json" with { type: "json" };

// On Windows, hide console windows for spawned child processes.
// Effect's ChildProcess spawner doesn't pass `windowsHide` to Node's spawn,
// so we patch it globally to prevent window flashes for CLI tools like `claude`.
if (process.platform === "win32") {
  // ESM namespace imports are immutable to rolldown's static analysis, so use
  // createRequire to get the mutable CJS exports object for patching.
  const cp = createRequire(import.meta.url)("node:child_process") as typeof child_process;
  const originalSpawn = cp.spawn;
  cp.spawn = function patchedSpawn(...args: Parameters<typeof child_process.spawn>) {
    const options =
      typeof args[1] === "object" && !Array.isArray(args[1])
        ? args[1]
        : typeof args[2] === "object"
          ? args[2]
          : undefined;
    if (options && !("windowsHide" in options)) {
      (options as { windowsHide?: boolean }).windowsHide = true;
    }
    return originalSpawn.apply(this, args);
  } as typeof child_process.spawn;
}

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

Command.run(cli, { version }).pipe(
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
  NodeRuntime.runMain,
);
