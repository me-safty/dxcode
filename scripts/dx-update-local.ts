#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalConsole:off

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { normalizeGitRemoteUrl } from "@t3tools/shared/git";

function git(cwd: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function main() {
  const args = new Set(process.argv.slice(2));
  const cwd = NodePath.resolve(process.cwd());
  const origin = normalizeGitRemoteUrl(git(cwd, ["remote", "get-url", "origin"]));
  if (origin !== "github.com/me-safty/dxcode") throw new Error("origin is not me-safty/dxcode.");
  const remoteLine = git(cwd, ["ls-remote", "--heads", "origin", "refs/heads/dx/main"]);
  const remoteCommit = remoteLine.split(/\s+/u)[0];
  const localCommit = git(cwd, ["rev-parse", "dx/main"]);
  if (!remoteCommit || !/^[0-9a-f]{40,64}$/u.test(remoteCommit)) {
    throw new Error("origin/dx/main did not resolve to an immutable commit.");
  }
  console.log(
    JSON.stringify(
      {
        status: remoteCommit === localCommit ? "up-to-date" : "update-available",
        localCommit,
        remoteCommit,
      },
      null,
      2,
    ),
  );
  if (args.has("--build-only")) {
    NodeChildProcess.execFileSync("bun", ["run", "dist:desktop:dx:dmg"], {
      cwd,
      stdio: "inherit",
    });
    return;
  }
  if (args.has("--resume")) {
    throw new Error("Resume persisted DX update sessions from the DX Code update dialog.");
  }
  if (!args.has("--check") && !args.has("--no-install") && args.size > 0) {
    throw new Error("Usage: bun run dx:update-local [--check|--build-only|--no-install]");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
