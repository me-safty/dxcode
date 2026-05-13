#!/usr/bin/env node
// @effect-diagnostics globalConsole:off
// @effect-diagnostics globalTimersInEffect:off

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { ChildProcess } from "effect/unstable/process";

import { resolveOwnerPairingUrl, seedOwnerPairingTokenFromEnv } from "./owner-pairing-token.ts";

const DEFAULT_PORT = 3773;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TUNNEL = "t3code-local";
const WINDOWS_CLOUDFLARED_PATH = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const OWNER_PAIRING_REFRESH_INTERVAL_MS = 5_000;

class LocalCloudflareDevError extends Data.TaggedError("LocalCloudflareDevError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function resolveCloudflaredCommand(env: NodeJS.ProcessEnv, platform = process.platform) {
  return (
    env.T3CODE_CLOUDFLARED_PATH ?? (platform === "win32" ? WINDOWS_CLOUDFLARED_PATH : "cloudflared")
  );
}

export function buildServerArgs(input: {
  readonly port: number;
  readonly host: string;
}): ReadonlyArray<string> {
  return [
    "scripts/dev-runner.ts",
    "dev:server",
    "--port",
    String(input.port),
    "--host",
    input.host,
    "--no-browser",
  ];
}

export function parseEnvFileContents(contents: string): ReadonlyArray<readonly [string, string]> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        return [];
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1);
      return key.length > 0 ? [[key, value] as const] : [];
    });
}

function loadLocalEnvFiles(): Effect.Effect<void, LocalCloudflareDevError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const fileName of [".env.local", ".env"]) {
      if (!(yield* fs.exists(fileName))) {
        continue;
      }

      const contents = yield* fs.readFileString(fileName);
      for (const [key, value] of parseEnvFileContents(contents)) {
        process.env[key] = value;
      }
    }
  }).pipe(
    Effect.mapError(
      (cause) =>
        new LocalCloudflareDevError({
          message: "Failed to load local environment files.",
          cause,
        }),
    ),
  );
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid T3CODE_LOCAL_DEV_PORT: ${value}`);
  }

  return port;
}

function refreshOwnerPairingToken(): Effect.Effect<void, LocalCloudflareDevError> {
  return Effect.try({
    try: () => seedOwnerPairingTokenFromEnv(process.env, "dev"),
    catch: (cause) =>
      new LocalCloudflareDevError({
        message: "Failed to seed T3CODE_OWNER_PAIRING_TOKEN.",
        cause,
      }),
  }).pipe(Effect.asVoid);
}

function keepOwnerPairingTokenArmed() {
  if (!process.env.T3CODE_OWNER_PAIRING_TOKEN?.trim()) {
    return Effect.logInfo(
      "[local-cloudflare-dev] T3CODE_OWNER_PAIRING_TOKEN is not set; startup pairing URLs will still rotate.",
    );
  }

  return Effect.acquireRelease(
    Effect.gen(function* () {
      yield* refreshOwnerPairingToken();
      yield* Effect.logInfo(
        `[local-cloudflare-dev] stable owner pairing URL: ${resolveOwnerPairingUrl(process.env)}`,
      );
      return setInterval(() => {
        try {
          seedOwnerPairingTokenFromEnv(process.env, "dev");
        } catch (error) {
          console.error(
            "[local-cloudflare-dev] failed to refresh stable owner pairing token",
            error,
          );
        }
      }, OWNER_PAIRING_REFRESH_INTERVAL_MS);
    }),
    (timer) =>
      Effect.sync(() => {
        clearInterval(timer);
      }),
  ).pipe(Effect.asVoid);
}

function makeManagedProcess(name: string, command: string, args: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, args, {
      cwd: process.cwd(),
      env: process.env,
      extendEnv: false,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      detached: false,
      forceKillAfter: "1500 millis",
    });

    return { name, handle };
  });
}

export function runLocalCloudflareDev() {
  return Effect.gen(function* () {
    yield* loadLocalEnvFiles();
    yield* keepOwnerPairingTokenArmed();

    const port = yield* Effect.try({
      try: () => parsePort(process.env.T3CODE_LOCAL_DEV_PORT),
      catch: (cause) =>
        new LocalCloudflareDevError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const host = process.env.T3CODE_LOCAL_DEV_HOST?.trim() || DEFAULT_HOST;
    const tunnel = process.env.T3CODE_CLOUDFLARE_TUNNEL?.trim() || DEFAULT_TUNNEL;
    const skipCloudflare = process.env.T3CODE_SKIP_CLOUDFLARE === "1";

    yield* Effect.logInfo(
      `[local-cloudflare-dev] starting T3 dev server on http://${host}:${port} with hot reload`,
    );
    yield* Effect.logInfo(
      skipCloudflare
        ? "[local-cloudflare-dev] skipping Cloudflare tunnel because T3CODE_SKIP_CLOUDFLARE=1"
        : `[local-cloudflare-dev] starting Cloudflare tunnel ${tunnel}`,
    );

    const processes = yield* Effect.all(
      [
        makeManagedProcess("t3-dev-server", process.execPath, buildServerArgs({ port, host })),
        ...(skipCloudflare
          ? []
          : [
              makeManagedProcess("cloudflared", resolveCloudflaredCommand(process.env), [
                "tunnel",
                "run",
                tunnel,
              ]),
            ]),
      ],
      { concurrency: "unbounded" },
    );

    const firstExit = yield* Effect.raceAll(
      processes.map(({ name, handle }) =>
        handle.exitCode.pipe(Effect.map((exitCode) => ({ name, exitCode }))),
      ),
    );

    yield* Effect.logError(
      `[local-cloudflare-dev] ${firstExit.name} exited with code ${firstExit.exitCode}; stopping remaining processes.`,
    );

    yield* Effect.all(
      processes.map(({ handle }) =>
        handle.kill({ forceKillAfter: "1500 millis" }).pipe(Effect.ignore),
      ),
      { concurrency: "unbounded" },
    );

    if (firstExit.exitCode !== 0) {
      return yield* new LocalCloudflareDevError({
        message: `${firstExit.name} exited with code ${firstExit.exitCode}`,
      });
    }
  });
}

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

if (import.meta.main) {
  runLocalCloudflareDev().pipe(Effect.scoped, Effect.provide(cliRuntimeLayer), NodeRuntime.runMain);
}
