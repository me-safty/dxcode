import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PluginId, type PluginLockfilePlugin } from "@t3tools/contracts/plugin";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as PluginLockfileStoreModule from "./PluginLockfileStore.ts";
import {
  PluginLockfileCorruptError,
  PluginLockfileTransitionError,
} from "./PluginLockfileStore.ts";

const layer = it.layer(
  PluginLockfileStoreModule.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-plugin-lockfile-" })),
    ),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(TestClock.layer()),
  ),
);

const pluginId = PluginId.make("test-plugin");

const makePlugin = (overrides: Partial<PluginLockfilePlugin> = {}): PluginLockfilePlugin => ({
  version: "1.0.0",
  sha256: "sha",
  sourceId: "local",
  enabled: true,
  state: "active",
  activation: { activatingSince: null, crashCount: 0 },
  installedAt: "2026-07-03T00:00:00.000Z",
  lastError: null,
  ...overrides,
});

layer("PluginLockfileStore", (it) => {
  it.effect("returns an empty lockfile when plugins.json is missing", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;

      const lockfile = yield* store.readLockfile;

      assert.deepEqual(lockfile, { sources: [], plugins: {} });
    }),
  );

  it.effect("returns a typed error for corrupt lockfile JSON", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      yield* fs.makeDirectory(path.dirname(store.lockfilePath), { recursive: true });
      yield* fs.writeFileString(store.lockfilePath, "{not-json");

      const result = yield* Effect.result(store.readLockfile);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, PluginLockfileCorruptError);
      }
      yield* fs.remove(store.lockfilePath, { force: true });
    }),
  );

  it.effect("serializes concurrent mutations so both updates apply", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;

      yield* store.updatePlugin(pluginId, () => Effect.succeed(makePlugin()));
      yield* Effect.all(
        [
          store.updatePlugin(pluginId, ({ current }) =>
            Effect.succeed(
              current
                ? {
                    ...current,
                    activation: {
                      ...current.activation,
                      crashCount: current.activation.crashCount + 1,
                    },
                  }
                : undefined,
            ),
          ),
          store.updatePlugin(pluginId, ({ current }) =>
            Effect.succeed(
              current
                ? {
                    ...current,
                    activation: {
                      ...current.activation,
                      crashCount: current.activation.crashCount + 1,
                    },
                  }
                : undefined,
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      const lockfile = yield* store.readLockfile;
      assert.equal(lockfile.plugins[pluginId]?.activation.crashCount, 2);
    }),
  );

  it.effect("reclaims stale advisory locks", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      yield* fs.makeDirectory(path.dirname(store.advisoryLockPath), { recursive: true });
      yield* fs.writeFileString(store.advisoryLockPath, "stale");
      const stale = DateTime.toDateUtc(DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"));
      yield* fs.utimes(store.advisoryLockPath, stale, stale);
      yield* TestClock.setTime(120_000);

      yield* store.updatePlugin(pluginId, () => Effect.succeed(makePlugin()));

      const lockfile = yield* store.readLockfile;
      assert.equal(lockfile.plugins[pluginId]?.version, "1.0.0");
    }),
  );

  it.effect("advisory lock finalizer only removes a lock it still owns", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;
      const fs = yield* FileSystem.FileSystem;

      // While we hold the lock, simulate another process reclaiming it by
      // overwriting the lock file with a different owner token.
      yield* store.updatePlugin(pluginId, () =>
        Effect.gen(function* () {
          yield* fs
            .writeFileString(store.advisoryLockPath, "9999:foreign-owner-token\n")
            .pipe(Effect.orDie);
          return makePlugin();
        }),
      );

      // Our finalizer must NOT delete the foreign-owned lock; doing so would
      // break single-writer for the process that now holds it.
      assert.isTrue(yield* fs.exists(store.advisoryLockPath));
      const content = yield* fs.readFileString(store.advisoryLockPath);
      assert.isTrue(content.includes("foreign-owner-token"));

      yield* fs.remove(store.advisoryLockPath, { force: true });
    }),
  );

  it.effect("rejects invalid state transitions", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;

      yield* store.updatePlugin(pluginId, () => Effect.succeed(makePlugin({ state: "disabled" })));
      const result = yield* Effect.result(store.transition(pluginId, ["active"], "failed"));

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, PluginLockfileTransitionError);
      }
    }),
  );
});

// A FileSystem whose `open(..., { flag: "wx" })` returns a File whose writeAll
// always fails, simulating an IO error (ENOSPC) after `wx` has already created
// the advisory lock file. Only the "wx" open is intercepted so the temp-file
// write path is unaffected; the file-close finalizer lives on the underlying
// acquireRelease, so overriding writeAll alone is safe.
const writeFailingFileSystem = (base: FileSystem.FileSystem): FileSystem.FileSystem => ({
  ...base,
  open: (path, options) =>
    options?.flag === "wx"
      ? base.open(path, options).pipe(
          Effect.map((file) => {
            const failing = Object.create(file);
            failing.writeAll = () => Effect.fail({ _tag: "SimulatedWriteFailure" as const });
            return failing as FileSystem.File;
          }),
        )
      : base.open(path, options),
});

const writeFailingLayer = it.layer(
  PluginLockfileStoreModule.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-plugin-lockfile-fail-" })),
    ),
    Layer.provideMerge(
      Layer.effect(
        FileSystem.FileSystem,
        FileSystem.FileSystem.pipe(Effect.map(writeFailingFileSystem)),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Layer.provideMerge(TestClock.layer()),
  ),
);

writeFailingLayer("PluginLockfileStore advisory lock cleanup", (it) => {
  it.effect("removes the just-created lock file when the acquire write fails", () =>
    Effect.gen(function* () {
      const store = yield* PluginLockfileStoreModule.PluginLockfileStore;
      const fs = yield* FileSystem.FileSystem;

      const result = yield* Effect.result(
        store.updatePlugin(pluginId, () => Effect.succeed(makePlugin())),
      );
      assert.isTrue(Result.isFailure(result));
      // `wx` created the lock file, but writeAll failed; onError must remove it
      // so a partial acquire does not orphan a lock that would block all
      // mutations until STALE_LOCK_MS elapses.
      assert.isFalse(yield* fs.exists(store.advisoryLockPath));
    }),
  );
});
