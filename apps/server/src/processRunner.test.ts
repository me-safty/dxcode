import os from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  isWindowsCommandNotFound,
  ProcessOutputLimitError,
  ProcessTimeoutError,
  runProcess,
} from "./processRunner.ts";

const HELPER_SCRIPT_SOURCE = [
  "const mode = process.argv[2];",
  "if (mode === 'stdout-bytes') {",
  "  process.stdout.write('x'.repeat(Number(process.argv[3] ?? '0')));",
  "} else if (mode === 'stdin-echo') {",
  "  process.stdin.setEncoding('utf8');",
  "  let data = '';",
  "  process.stdin.on('data', (chunk) => { data += chunk; });",
  "  process.stdin.on('end', () => { process.stdout.write(data); });",
  "} else if (mode === 'stderr-exit') {",
  "  process.stderr.write(process.argv[3] ?? '');",
  "  process.exit(Number(process.argv[4] ?? '0'));",
  "} else if (mode === 'sleep') {",
  "  setTimeout(() => process.stdout.write('late'), Number(process.argv[3] ?? '0'));",
  "} else if (mode === 'spam-stdout') {",
  "  const chunk = 'x'.repeat(Number(process.argv[3] ?? '64'));",
  "  setInterval(() => { process.stdout.write(chunk); }, Number(process.argv[4] ?? '5'));",
  "} else {",
  "  process.exit(2);",
  "}",
  "",
].join("\n");

const withHelperScript = <A, E, R>(f: (helperScriptPath: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      directory: os.tmpdir(),
      prefix: "t3-process-runner-test-",
    });
    const helperPath = path.join(directory, "helper.js");
    yield* fileSystem.writeFileString(helperPath, HELPER_SCRIPT_SOURCE);
    return yield* f(helperPath);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("runProcess", () => {
  const runLive = (input: Parameters<typeof runProcess>[1]) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return yield* runProcess(spawner, input);
    }).pipe(Effect.provide(NodeServices.layer));

  it("supports the new Effect-native API", async () => {
    const result = await Effect.runPromise(
      withHelperScript((helperScriptPath) =>
        runLive({
          command: "node",
          args: [helperScriptPath, "stdout-bytes", "32"],
        }),
      ),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("x".repeat(32));
    expect(result.timedOut).toBe(false);
  });

  it("supports an injected ChildProcessSpawner service", async () => {
    const fakeSpawner = ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };

      expect(childProcess.command).toBe("fake");
      expect(childProcess.args).toEqual(["--ok"]);

      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode("ok")),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      );
    });

    const result = await Effect.runPromise(
      runProcess(fakeSpawner, {
        command: "fake",
        args: ["--ok"],
      }),
    );

    expect(result.stdout).toBe("ok");
    expect(result.code).toBe(0);
  });

  it("fails when output exceeds max buffer in default mode", async () => {
    await expect(
      Effect.runPromise(
        withHelperScript((helperScriptPath) =>
          runLive({
            command: "node",
            args: [helperScriptPath, "stdout-bytes", "2048"],
            maxOutputBytes: 128,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ProcessOutputLimitError);
  });

  it("fails fast on output limit before timeout for long-running output", async () => {
    await expect(
      Effect.runPromise(
        withHelperScript((helperScriptPath) =>
          runLive({
            command: "node",
            args: [helperScriptPath, "spam-stdout", "64", "5"],
            maxOutputBytes: 128,
            timeoutMs: 2_000,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ProcessOutputLimitError);
  });

  it("truncates output when outputMode is truncate", async () => {
    const result = await Effect.runPromise(
      withHelperScript((helperScriptPath) =>
        runLive({
          command: "node",
          args: [helperScriptPath, "stdout-bytes", "2048"],
          maxOutputBytes: 128,
          outputMode: "truncate",
        }),
      ),
    );

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(128);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
  });

  it("writes stdin before waiting for exit", async () => {
    const result = await Effect.runPromise(
      withHelperScript((helperScriptPath) =>
        runLive({
          command: "node",
          args: [helperScriptPath, "stdin-echo"],
          stdin: "stdin payload",
        }),
      ),
    );

    expect(result.stdout).toBe("stdin payload");
  });

  it("returns output for non-zero exit codes", async () => {
    const result = await Effect.runPromise(
      withHelperScript((helperScriptPath) =>
        runLive({
          command: "node",
          args: [helperScriptPath, "stderr-exit", "boom", "2"],
        }),
      ),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toBe("boom");
  });

  it("fails on timeout", async () => {
    await expect(
      Effect.runPromise(
        withHelperScript((helperScriptPath) =>
          runLive({
            command: "node",
            args: [helperScriptPath, "sleep", "500"],
            timeoutMs: 50,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
  });

  it("returns a synthetic timed out result when timeoutBehavior is timedOutResult", async () => {
    const result = await Effect.runPromise(
      withHelperScript((helperScriptPath) =>
        runLive({
          command: "node",
          args: [helperScriptPath, "sleep", "500"],
          timeoutMs: 50,
          timeoutBehavior: "timedOutResult",
        }),
      ),
    );

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      code: null,
      timedOut: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });
});

describe("isWindowsCommandNotFound", () => {
  it("matches the localized German cmd.exe error text", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    try {
      expect(
        isWindowsCommandNotFound(
          1,
          "wird nicht als interner oder externer Befehl, betriebsfahiges Programm oder Batch-Datei erkannt",
        ),
      ).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });
});
