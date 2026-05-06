import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import * as EffectPath from "effect/Path";

import { DesktopEnvironment, makeDesktopEnvironment } from "./desktopEnvironment.ts";
import {
  DesktopBackendOutputLog,
  DesktopBackendOutputLogLive,
  DesktopLoggerLive,
  makeRotatingLogFileWriter,
} from "./desktopLogger.ts";

const textEncoder = new TextEncoder();

const makePackagedEnvironment = (baseDir: string) =>
  makeDesktopEnvironment({
    dirname: "/repo/apps/desktop/dist-electron",
    env: {
      HOME: baseDir,
      T3CODE_HOME: baseDir,
    },
    cwd: "/cwd",
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.22",
    appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
    isPackaged: true,
    resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
    runningUnderArm64Translation: false,
  }).pipe(Effect.provide(EffectPath.layer));

describe("DesktopLogger", () => {
  it.effect("rotates log files through the Effect FileSystem service", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-logger-",
      });
      const logPath = path.join(dir, "desktop-main.log");
      const writer = yield* makeRotatingLogFileWriter({
        filePath: logPath,
        maxBytes: 8,
        maxFiles: 2,
      });

      yield* writer.writeText("12345678");
      yield* writer.writeText("abc");

      assert.equal(yield* fileSystem.readFileString(logPath), "abc");
      assert.equal(
        yield* fileSystem.readFileString(path.join(dir, "desktop-main.log.1")),
        "12345678",
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("writes packaged desktop Effect logs through the logger layer", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-logger-layer-",
      });
      const environment = yield* makePackagedEnvironment(baseDir);

      yield* Effect.logInfo("desktop logger layer test").pipe(
        Effect.annotateLogs({ testRun: "desktop-logger-layer" }),
        Effect.provide(DesktopLoggerLive),
        Effect.provideService(DesktopEnvironment, environment),
        Effect.scoped,
      );

      const contents = yield* fileSystem.readFileString(
        path.join(environment.logDir, "desktop-main.log"),
      );
      assert.match(contents, /desktop logger layer test/);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("writes packaged backend child output through an Effect service", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-backend-output-",
      });
      const environment = yield* makePackagedEnvironment(baseDir);

      yield* Effect.gen(function* () {
        const outputLog = yield* DesktopBackendOutputLog;
        yield* outputLog.writeSessionBoundary({
          phase: "START",
          runId: "run-1",
          details: "pid=123   cwd=/tmp/project",
        });
        yield* outputLog.writeOutputChunk("stdout", textEncoder.encode("server ready\n"));
      }).pipe(
        Effect.provide(DesktopBackendOutputLogLive),
        Effect.provideService(DesktopEnvironment, environment),
      );

      const contents = yield* fileSystem.readFileString(
        path.join(environment.logDir, "server-child.log"),
      );
      assert.match(contents, /APP SESSION START run=run-1 pid=123 cwd=\/tmp\/project/);
      assert.match(contents, /server ready/);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
