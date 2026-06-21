#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeURL from "node:url";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class SyncUpstreamError extends Schema.TaggedErrorClass<SyncUpstreamError>()(
  "SyncUpstreamError",
  {
    message: Schema.String,
  },
) {}

interface SyncOptions {
  readonly branch: string;
  readonly dryRun: boolean;
  readonly push: boolean;
  readonly upstreamRef: string;
  readonly verify: boolean;
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const spawnAndCollect = Effect.fn("spawnAndCollect")(function* (
  command: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(command, args));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      collectStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode } as const;
});

const run = Effect.fn("run")(function* (command: string, args: ReadonlyArray<string>) {
  yield* Console.log(`> ${[command, ...args].join(" ")}`);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new SyncUpstreamError({
      message: `${command} ${args.join(" ")} exited with ${exitCode}`,
    });
  }
});

const read = Effect.fn("read")(function* (command: string, args: ReadonlyArray<string>) {
  const result = yield* spawnAndCollect(command, args);
  if (result.exitCode !== 0) {
    return yield* new SyncUpstreamError({
      message: `${command} ${args.join(" ")} exited with ${result.exitCode}: ${result.stderr}`,
    });
  }
  return result.stdout.trim();
});

const ensureCleanWorktree = Effect.fn("ensureCleanWorktree")(function* () {
  const status = yield* read("git", ["status", "--porcelain"]);
  if (status.length > 0) {
    return yield* new SyncUpstreamError({
      message: [
        "Working tree is not clean. Commit or stash local changes before syncing upstream.",
        status,
      ].join("\n"),
    });
  }
});

const ensureBranch = Effect.fn("ensureBranch")(function* (branch: string) {
  const currentBranch = yield* read("git", ["branch", "--show-current"]);
  if (currentBranch !== branch) {
    return yield* new SyncUpstreamError({
      message: `Expected branch ${branch}, but current branch is ${currentBranch}.`,
    });
  }
});

const countAheadBehind = Effect.fn("countAheadBehind")(function* (
  leftRef: string,
  rightRef: string,
) {
  const [aheadRaw, behindRaw] = (yield* read("git", [
    "rev-list",
    "--left-right",
    "--count",
    `${leftRef}...${rightRef}`,
  ])).split(/\s+/);
  return { ahead: Number(aheadRaw), behind: Number(behindRaw) };
});

const maybeInstallDependencies = Effect.fn("maybeInstallDependencies")(function* (
  previousHead: string,
) {
  const changedFiles = (yield* read("git", ["diff", "--name-only", `${previousHead}..HEAD`]))
    .split("\n")
    .filter((file) => file.length > 0);
  const dependencyFilesChanged = changedFiles.some((file) =>
    [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/desktop/package.json",
      "apps/mobile/package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "packages/contracts/package.json",
      "packages/shared/package.json",
    ].includes(file),
  );
  if (dependencyFilesChanged) {
    yield* run("pnpm", ["install", "--frozen-lockfile"]);
  }
});

export const syncUpstream = Effect.fn("syncUpstream")(function* (options: SyncOptions) {
  yield* ensureBranch(options.branch);
  yield* ensureCleanWorktree();

  yield* run("git", ["fetch", "--prune", "origin"]);
  yield* run("git", ["fetch", "--prune", "upstream"]);

  const before = yield* countAheadBehind("HEAD", options.upstreamRef);
  yield* Console.log(
    `Current branch is ${before.ahead} commits ahead of and ${before.behind} commits behind ${options.upstreamRef}.`,
  );

  if (before.behind === 0) {
    yield* Console.log("Already up to date with upstream.");
    if (options.push) {
      yield* run("git", ["push", "origin", options.branch]);
    }
    return;
  }

  if (options.dryRun) {
    yield* Console.log("Dry run complete. No merge performed.");
    return;
  }

  const previousHead = yield* read("git", ["rev-parse", "HEAD"]);
  yield* run("git", ["merge", "--no-edit", options.upstreamRef]).pipe(
    Effect.mapError(
      (cause) =>
        new SyncUpstreamError({
          message: [
            "Upstream merge stopped with conflicts.",
            "Resolve the conflicts, run checks, commit the merge, then push origin.",
            String(cause),
          ].join("\n"),
        }),
    ),
  );

  yield* maybeInstallDependencies(previousHead);

  if (options.verify) {
    yield* run("pnpm", ["exec", "vp", "check"]);
    yield* run("pnpm", ["exec", "vp", "run", "typecheck"]);
  }

  if (options.push) {
    yield* run("git", ["push", "origin", options.branch]);
  }

  const after = yield* countAheadBehind("HEAD", options.upstreamRef);
  yield* Console.log(
    `Done. Current branch is ${after.ahead} commits ahead of and ${after.behind} commits behind ${options.upstreamRef}.`,
  );
});

const syncUpstreamCommand = Command.make(
  "sync-upstream",
  {
    branch: Flag.string("branch").pipe(Flag.withDefault("main")),
    upstream: Flag.string("upstream").pipe(Flag.withDefault("upstream/main")),
    dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
    push: Flag.boolean("push").pipe(Flag.withDefault(false)),
    verify: Flag.boolean("verify").pipe(Flag.withDefault(false)),
  },
  ({ branch, upstream, dryRun, push, verify }) =>
    syncUpstream({ branch, upstreamRef: upstream, dryRun, push, verify }),
).pipe(
  Command.withDescription(
    "Merge upstream/main into the fork safely, optionally verify and push origin/main.",
  ),
);

const isEntryPoint =
  typeof process.argv[1] === "string" && process.argv[1] === NodeURL.fileURLToPath(import.meta.url);

if (isEntryPoint) {
  Command.run(syncUpstreamCommand, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
