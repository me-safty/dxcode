import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { RotatingFileSink } from "@t3tools/shared/logging";
import { Effect, FileSystem, Path } from "effect";

function makeTempDir() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeTempDirectoryScoped({ prefix: "t3-rotating-log-" });
  });
}

describe("RotatingFileSink", () => {
  it.effect("rotates when writes exceed max bytes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* makeTempDir();
      const logPath = path.join(dir, "desktop-main.log");
      const sink = new RotatingFileSink({
        filePath: logPath,
        maxBytes: 10,
        maxFiles: 3,
      });

      yield* Effect.sync(() => {
        sink.write("12345");
        sink.write("67890");
        sink.write("abc");
      });

      assert.equal(yield* fs.readFileString(path.join(dir, "desktop-main.log")), "abc");
      assert.equal(yield* fs.readFileString(path.join(dir, "desktop-main.log.1")), "1234567890");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("retains only maxFiles backups", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* makeTempDir();
      const logPath = path.join(dir, "server-child.log");
      const sink = new RotatingFileSink({
        filePath: logPath,
        maxBytes: 4,
        maxFiles: 2,
      });

      yield* Effect.sync(() => {
        sink.write("aaaa");
        sink.write("bbbb");
        sink.write("cccc");
        sink.write("dddd");
      });

      assert.equal(yield* fs.exists(path.join(dir, "server-child.log.1")), true);
      assert.equal(yield* fs.exists(path.join(dir, "server-child.log.2")), true);
      assert.equal(yield* fs.exists(path.join(dir, "server-child.log.3")), false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("prunes stale backups above maxFiles on startup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* makeTempDir();
      const logPath = path.join(dir, "desktop-main.log");
      yield* fs.writeFileString(path.join(dir, "desktop-main.log.1"), "first");
      yield* fs.writeFileString(path.join(dir, "desktop-main.log.4"), "stale");

      yield* Effect.sync(() => {
        const sink = new RotatingFileSink({
          filePath: logPath,
          maxBytes: 16,
          maxFiles: 2,
        });
        sink.write("hello");
      });

      assert.equal(yield* fs.exists(path.join(dir, "desktop-main.log.4")), false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
