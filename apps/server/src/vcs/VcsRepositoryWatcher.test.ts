import { assert, describe, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  isRelevantGitMetadataWatchPath,
  isRelevantWorktreeWatchPath,
  make,
} from "./VcsRepositoryWatcher.ts";

const watcherTestLayer = Layer.merge(
  NodeFileSystem.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FileSystem.WatchBackend,
        FileSystem.WatchBackend.of({
          register: () =>
            Option.some(Stream.make({ _tag: "Update" as const, path: "external.ts" })),
        }),
      ),
    ),
  ),
  NodePath.layer,
);

describe("VcsRepositoryWatcher", () => {
  it("keeps working-tree changes and excludes duplicate Git metadata events", () => {
    assert.isTrue(isRelevantWorktreeWatchPath("src/app.ts"));
    assert.isTrue(isRelevantWorktreeWatchPath("new-file.ts"));
    assert.isFalse(isRelevantWorktreeWatchPath(".git"));
    assert.isFalse(isRelevantWorktreeWatchPath(".git/index"));
    assert.isFalse(isRelevantWorktreeWatchPath(".git\\refs\\heads\\main"));
  });

  it("keeps status-relevant metadata and drops object/log noise", () => {
    for (const path of [
      "HEAD",
      "index",
      "packed-refs",
      "config",
      "refs/heads/main",
      "worktrees/feature/index",
    ]) {
      assert.isTrue(isRelevantGitMetadataWatchPath(path), path);
    }

    for (const path of ["objects/ab/cdef", "logs/HEAD", "hooks/pre-commit", "FETCH_HEAD.lock"]) {
      assert.isFalse(isRelevantGitMetadataWatchPath(path), path);
    }
  });

  it.effect("emits filesystem change hints", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-repository-watch-" });
      yield* fs.makeDirectory(path.join(cwd, ".git"));
      const watcher = yield* make;
      const events = yield* watcher.changes(cwd).pipe(
        Stream.filter((event) => event.source === "native"),
        Stream.take(1),
        Stream.runCollect,
      );
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], { source: "native" });
    }).pipe(Effect.provide(watcherTestLayer)),
  );

  it.effect("starts watching when a repository appears after subscription", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-repository-discovery-" });
      const watcher = yield* make;
      const firstEvent = yield* Deferred.make<void>();
      const fiber = yield* watcher.changes(cwd).pipe(
        Stream.tap(() => Deferred.succeed(firstEvent, undefined).pipe(Effect.ignore)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Deferred.await(firstEvent);
      yield* fs.makeDirectory(path.join(cwd, ".git"));
      yield* TestClock.adjust(Duration.seconds(2));
      const events = yield* Fiber.join(fiber);

      assert.deepEqual(Array.from(events), [
        { source: "poll" },
        { source: "poll" },
        { source: "native" },
      ]);
    }).pipe(Effect.provide(Layer.merge(watcherTestLayer, TestClock.layer()))),
  );
});
