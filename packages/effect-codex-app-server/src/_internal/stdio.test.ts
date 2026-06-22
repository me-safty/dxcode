import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as CodexError from "../errors.ts";
import { makeStderrTailCapture, makeTerminationError } from "./stdio.ts";

const encoder = new TextEncoder();

describe("Codex App Server child process termination", () => {
  it.effect("retains the process identifier with the exit code", () =>
    Effect.gen(function* () {
      const error = yield* makeTerminationError({
        pid: ChildProcessSpawner.ProcessId(51),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(9)),
      });

      assert.instanceOf(error, CodexError.CodexAppServerProcessExitedError);
      assert.equal(error.pid, 51);
      assert.equal(error.code, 9);
      assert.equal(error.message, "Codex App Server process exited with code 9");
    }),
  );

  it.effect("retains the process identifier and exact exit-status cause", () =>
    Effect.gen(function* () {
      const rootCause = new Error("private process diagnostics");
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "ChildProcess",
        method: "exitCode",
        cause: rootCause,
      });
      const error = yield* makeTerminationError({
        pid: ChildProcessSpawner.ProcessId(52),
        exitCode: Effect.fail(cause),
      });

      assert.instanceOf(error, CodexError.CodexAppServerTransportError);
      assert.equal(error.pid, 52);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Codex App Server transport operation 'read-process-exit-status' failed.",
      );
      assert.notInclude(error.message, rootCause.message);
    }),
  );

  it.effect("adds the trimmed truncated stderr tail to process-exited errors", () =>
    Effect.gen(function* () {
      const capture = yield* makeStderrTailCapture(
        Stream.fromIterable([encoder.encode("prefix-Access is denied\n")]),
        17,
      );
      yield* capture.drain;
      const snapshot = yield* capture.snapshot;
      const error = yield* makeTerminationError(
        {
          pid: ChildProcessSpawner.ProcessId(53),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
        },
        Effect.succeed(snapshot),
      );

      assert.instanceOf(error, CodexError.CodexAppServerProcessExitedError);
      assert.equal(error.stderrTail, "Access is denied");
      assert.equal(error.stderrTruncated, true);
      assert.include(error.message, "recent stderr (last 4096 bytes, truncated)");
      assert.include(error.message, "Access is denied");
    }),
  );
});
