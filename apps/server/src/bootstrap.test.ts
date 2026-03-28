import * as NFS from "node:fs";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FileSystem, Schema } from "effect";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { readBootstrapEnvelope, resolveFdPath } from "./bootstrap";
import { assertNone, assertSome } from "@effect/vitest/utils";

const bootstrapFsInterceptor = vi.hoisted(() => ({
  failOpenPath: null as string | null,
  failCreateReadStreamForDuplicatedPath: null as string | null,
  duplicatedFdForPathFailure: null as number | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      const [filePath, flags] = args;
      if (
        typeof filePath === "string" &&
        filePath === bootstrapFsInterceptor.failOpenPath &&
        flags === "r"
      ) {
        const error = new Error("no such device or address");
        Object.assign(error, { code: "ENXIO" });
        throw error;
      }
      const fd = (actual.openSync as (...a: typeof args) => number)(...args);
      if (
        typeof filePath === "string" &&
        filePath === bootstrapFsInterceptor.failCreateReadStreamForDuplicatedPath &&
        flags === "r"
      ) {
        bootstrapFsInterceptor.duplicatedFdForPathFailure = fd;
      }
      return fd;
    },
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const [, options] = args;
      const fd = typeof options === "object" && options && "fd" in options ? options.fd : undefined;
      if (typeof fd === "number" && fd === bootstrapFsInterceptor.duplicatedFdForPathFailure) {
        const error = new Error("bad file descriptor");
        Object.assign(error, { code: "EBADF" });
        throw error;
      }
      return (
        actual.createReadStream as (...a: typeof args) => ReturnType<typeof actual.createReadStream>
      )(...args);
    },
  };
});

const TestEnvelopeSchema = Schema.Struct({ mode: Schema.String });

it.layer(NodeServices.layer)("readBootstrapEnvelope", (it) => {
  it.effect("reads a bootstrap envelope from a provided fd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const filePath = yield* fs.makeTempFileScoped({ prefix: "t3-bootstrap-", suffix: ".ndjson" });

      yield* fs.writeFileString(
        filePath,
        `${yield* Schema.encodeEffect(Schema.fromJsonString(TestEnvelopeSchema))({
          mode: "desktop",
        })}\n`,
      );

      const fd = yield* Effect.acquireRelease(
        Effect.sync(() => NFS.openSync(filePath, "r")),
        (fd) => Effect.sync(() => NFS.closeSync(fd)),
      );

      const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
      assertSome(payload, {
        mode: "desktop",
      });
    }),
  );

  it.effect("falls back to reading the inherited fd when path duplication fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const filePath = yield* fs.makeTempFileScoped({ prefix: "t3-bootstrap-", suffix: ".ndjson" });

      yield* fs.writeFileString(
        filePath,
        `${yield* Schema.encodeEffect(Schema.fromJsonString(TestEnvelopeSchema))({
          mode: "desktop",
        })}\n`,
      );

      // Open without acquireRelease: the direct-stream fallback uses autoClose: true,
      // so the stream owns the fd lifecycle and closes it asynchronously on end.
      // Attempting to also close it synchronously in a finalizer races with the
      // stream's async close and produces an uncaught EBADF.
      const fd = NFS.openSync(filePath, "r");

      bootstrapFsInterceptor.failOpenPath = resolveFdPath(fd) ?? null;
      try {
        const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
        assertSome(payload, {
          mode: "desktop",
        });
      } finally {
        bootstrapFsInterceptor.failOpenPath = null;
      }
    }),
  );

  it.effect("closes the duplicated fd before falling back when the duplicated stream fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const filePath = yield* fs.makeTempFileScoped({ prefix: "t3-bootstrap-", suffix: ".ndjson" });

      yield* fs.writeFileString(
        filePath,
        `${yield* Schema.encodeEffect(Schema.fromJsonString(TestEnvelopeSchema))({
          mode: "desktop",
        })}\n`,
      );

      const fd = NFS.openSync(filePath, "r");
      const duplicatedFdPath = resolveFdPath(fd);
      assert.notStrictEqual(duplicatedFdPath, undefined);
      const closeSyncSpy = vi.spyOn(NFS, "closeSync");
      bootstrapFsInterceptor.failCreateReadStreamForDuplicatedPath = duplicatedFdPath;

      try {
        const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
        assertSome(payload, {
          mode: "desktop",
        });

        const duplicatedFd = bootstrapFsInterceptor.duplicatedFdForPathFailure;
        assert.notStrictEqual(duplicatedFd, null);
        assert.ok(closeSyncSpy.mock.calls.some(([closedFd]) => closedFd === duplicatedFd));
      } finally {
        bootstrapFsInterceptor.failCreateReadStreamForDuplicatedPath = null;
        bootstrapFsInterceptor.duplicatedFdForPathFailure = null;
        closeSyncSpy.mockRestore();
      }
    }),
  );

  it.effect("returns none when the fd is unavailable", () =>
    Effect.gen(function* () {
      const fd = NFS.openSync("/dev/null", "r");
      NFS.closeSync(fd);

      const payload = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, { timeoutMs: 100 });
      assertNone(payload);
    }),
  );

  it.effect("returns none when the bootstrap read times out before any value arrives", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-bootstrap-" });
      const fifoPath = path.join(tempDir, "bootstrap.pipe");

      yield* Effect.sync(() => execFileSync("mkfifo", [fifoPath]));

      const _writer = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn("sh", ["-c", 'exec 3>"$1"; sleep 60', "sh", fifoPath], {
            stdio: ["ignore", "ignore", "ignore"],
          }),
        ),
        (writer) =>
          Effect.sync(() => {
            writer.kill("SIGKILL");
          }),
      );

      const fd = yield* Effect.acquireRelease(
        Effect.sync(() => NFS.openSync(fifoPath, "r")),
        (fd) => Effect.sync(() => NFS.closeSync(fd)),
      );

      const fiber = yield* readBootstrapEnvelope(TestEnvelopeSchema, fd, {
        timeoutMs: 100,
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(100));

      const payload = yield* Fiber.join(fiber);
      assertNone(payload);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
