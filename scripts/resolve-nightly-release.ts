#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Data, Effect, FileSystem, Option, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";

interface ResolveNightlyReleaseOptions {
  readonly date: string;
  readonly runNumber: string;
  readonly sha: string;
  readonly rootDir?: string;
}

interface NightlyReleaseMetadata {
  readonly baseVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly name: string;
  readonly shortSha: string;
}

class NightlyReleaseError extends Data.TaggedError("NightlyReleaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function validateDate(date: string): string {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Invalid nightly release date '${date}'. Expected YYYYMMDD.`);
  }
  return date;
}

function validateRunNumber(runNumber: string): string {
  if (!/^[1-9]\d*$/.test(runNumber)) {
    throw new Error(`Invalid nightly run number '${runNumber}'. Expected a positive integer.`);
  }
  return runNumber;
}

function validateSha(sha: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`Invalid git sha '${sha}'. Expected 7-40 hex characters.`);
  }
  return sha.toLowerCase();
}

export const resolveNightlyReleaseMetadata = Effect.fn("resolveNightlyReleaseMetadata")(function* (
  options: ResolveNightlyReleaseOptions,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const packageJsonPath = path.join(rootDir, "apps/desktop/package.json");
  const packageJsonRaw = yield* fs.readFileString(packageJsonPath).pipe(
    Effect.mapError(
      (cause) =>
        new NightlyReleaseError({
          message: `Failed to read ${packageJsonPath}.`,
          cause,
        }),
    ),
  );

  const packageJson = yield* Effect.try({
    try: () => JSON.parse(packageJsonRaw) as { version?: unknown },
    catch: (cause) =>
      new NightlyReleaseError({
        message: `Failed to parse ${packageJsonPath}.`,
        cause,
      }),
  });

  if (typeof packageJson.version !== "string") {
    return yield* new NightlyReleaseError({
      message: `Missing string version in ${packageJsonPath}.`,
    });
  }

  const match = packageJson.version.match(/^(\d+\.\d+\.\d+)/);
  if (!match) {
    return yield* new NightlyReleaseError({
      message: `Desktop package version '${packageJson.version}' does not start with X.Y.Z semver core.`,
    });
  }

  const date = yield* Effect.try({
    try: () => validateDate(options.date),
    catch: (cause) =>
      new NightlyReleaseError({
        message: cause instanceof Error ? cause.message : "Invalid nightly release date.",
        cause,
      }),
  });
  const runNumber = yield* Effect.try({
    try: () => validateRunNumber(options.runNumber),
    catch: (cause) =>
      new NightlyReleaseError({
        message: cause instanceof Error ? cause.message : "Invalid nightly run number.",
        cause,
      }),
  });
  const sha = yield* Effect.try({
    try: () => validateSha(options.sha),
    catch: (cause) =>
      new NightlyReleaseError({
        message: cause instanceof Error ? cause.message : "Invalid nightly release sha.",
        cause,
      }),
  });

  const [baseVersion] = match;
  const shortSha = sha.slice(0, 12);
  const version = `${baseVersion}-nightly.${date}.${runNumber}`;

  return {
    baseVersion,
    version,
    tag: `nightly-v${version}`,
    name: `T3 Code Nightly ${version} (${shortSha})`,
    shortSha,
  } satisfies NightlyReleaseMetadata;
});

const writeOutput = Effect.fn("writeOutput")(function* (
  metadata: NightlyReleaseMetadata,
  writeGithubOutput: boolean,
) {
  const fs = yield* FileSystem.FileSystem;

  const entries = [
    ["base_version", metadata.baseVersion],
    ["version", metadata.version],
    ["tag", metadata.tag],
    ["name", metadata.name],
    ["short_sha", metadata.shortSha],
  ] as const;

  if (writeGithubOutput) {
    const githubOutputPath = process.env.GITHUB_OUTPUT;
    if (!githubOutputPath) {
      return yield* new NightlyReleaseError({
        message: "GITHUB_OUTPUT is required when --github-output is set.",
      });
    }

    const serialized = entries.map(([key, value]) => `${key}=${value}\n`).join("");
    yield* fs.writeFileString(githubOutputPath, serialized, { flag: "a" });
    return;
  }

  for (const [key, value] of entries) {
    yield* Effect.sync(() => {
      console.log(`${key}=${value}`);
    });
  }
});

const command = Command.make(
  "resolve-nightly-release",
  {
    date: Flag.string("date").pipe(Flag.withDescription("Nightly build date in YYYYMMDD.")),
    runNumber: Flag.string("run-number").pipe(Flag.withDescription("GitHub Actions run number.")),
    sha: Flag.string("sha").pipe(Flag.withDescription("Commit sha for the nightly build.")),
    rootDir: Flag.string("root").pipe(
      Flag.optional,
      Flag.withDescription("Repository root override."),
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Write values to GITHUB_OUTPUT instead of stdout."),
      Flag.withDefault(false),
    ),
  },
  ({ date, runNumber, sha, rootDir, githubOutput }) =>
    resolveNightlyReleaseMetadata({
      date,
      runNumber,
      sha,
      ...(Option.isSome(rootDir) ? { rootDir: rootDir.value } : {}),
    }).pipe(Effect.flatMap((metadata) => writeOutput(metadata, githubOutput))),
).pipe(Command.withDescription("Resolve nightly release version metadata."));

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  Command.run(command, {
    version: "0.0.0",
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
