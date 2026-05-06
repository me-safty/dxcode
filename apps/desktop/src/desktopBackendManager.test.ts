import { assert, describe, it } from "@effect/vitest";
import { Deferred, Duration, Effect, FileSystem, Layer, Option, Queue, Scope } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  DesktopBackendConfiguration,
  DesktopBackendEvents,
  DesktopBackendManager,
  DesktopBackendManagerLive,
  DesktopBackendProcessRunner,
  type DesktopBackendEventsShape,
  type DesktopBackendProcessRunnerShape,
  type DesktopBackendStartConfig,
} from "./desktopBackendManager.ts";

const baseConfig: DesktopBackendStartConfig = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: { ELECTRON_RUN_AS_NODE: "1" },
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

function makeManagerLayer(input: {
  readonly runner: DesktopBackendProcessRunnerShape;
  readonly events?: Partial<DesktopBackendEventsShape>;
  readonly config?: DesktopBackendStartConfig;
}) {
  return DesktopBackendManagerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          exists: () => Effect.succeed(true),
        }),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("unexpected child process spawn")),
        ),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("unexpected HTTP request")),
        ),
        Layer.succeed(DesktopBackendConfiguration, {
          resolve: Effect.succeed(input.config ?? baseConfig),
        }),
        Layer.succeed(DesktopBackendProcessRunner, input.runner),
        Layer.succeed(DesktopBackendEvents, {
          onStarting: Effect.void,
          onStarted: () => Effect.void,
          onReady: Effect.void,
          onReadinessFailure: () => Effect.void,
          onOutput: () => Effect.void,
          onExit: () => Effect.void,
          onRestartScheduled: () => Effect.void,
          ...input.events,
        } satisfies DesktopBackendEventsShape),
      ),
    ),
  );
}

describe("DesktopBackendManager", () => {
  it.effect("starts the configured backend and closes the scoped process on stop", () => {
    return Effect.gen(function* () {
      let startCount = 0;
      let closedCount = 0;
      const closed = yield* Deferred.make<void>();
      const startedPids = yield* Queue.unbounded<number>();

      const layer = makeManagerLayer({
        events: {
          onStarted: ({ pid }) => Queue.offer(startedPids, pid).pipe(Effect.asVoid),
        },
        runner: {
          run: (options) =>
            Effect.gen(function* () {
              startCount += 1;
              const scope = yield* Scope.Scope;
              yield* Scope.addFinalizer(
                scope,
                Effect.sync(() => {
                  closedCount += 1;
                }).pipe(Effect.andThen(Deferred.succeed(closed, void 0))),
              );
              yield* options.onStarted?.(123) ?? Effect.void;
              yield* options.onReady?.() ?? Effect.void;
              yield* Deferred.await(closed);
              return { code: 0, reason: "code=0", cause: 0 };
            }),
        },
      });

      yield* Effect.gen(function* () {
        const manager = yield* DesktopBackendManager;
        yield* manager.start;
        assert.equal(yield* Queue.take(startedPids), 123);

        const runningSnapshot = yield* manager.snapshot;
        assert.equal(runningSnapshot.ready, true);
        assert.deepEqual(runningSnapshot.activePid, Option.some(123));

        yield* manager.stop();
        assert.equal(startCount, 1);
        assert.equal(closedCount, 1);

        const stoppedSnapshot = yield* manager.snapshot;
        assert.equal(stoppedSnapshot.desiredRunning, false);
        assert.equal(stoppedSnapshot.ready, false);
        assert.equal(Option.isNone(stoppedSnapshot.activePid), true);
      }).pipe(Effect.provide(layer));
    });
  });

  it.effect("restarts an unexpectedly exited backend with the Effect clock", () => {
    return Effect.gen(function* () {
      const starts = yield* Queue.unbounded<number>();
      const restartDelays = yield* Queue.unbounded<number>();
      let startCount = 0;

      const layer = makeManagerLayer({
        events: {
          onRestartScheduled: ({ delay }) =>
            Queue.offer(restartDelays, Duration.toMillis(delay)).pipe(Effect.asVoid),
        },
        runner: {
          run: (options) =>
            Effect.gen(function* () {
              startCount += 1;
              yield* Queue.offer(starts, startCount);
              yield* options.onStarted?.(100 + startCount) ?? Effect.void;
              return {
                code: 1,
                reason: `code=1 run=${startCount}`,
                cause: ChildProcessSpawner.ExitCode(1),
              };
            }),
        },
      });

      yield* Effect.gen(function* () {
        const manager = yield* DesktopBackendManager;
        yield* manager.start;

        assert.equal(yield* Queue.take(starts), 1);
        assert.equal(yield* Queue.take(restartDelays), 500);

        yield* TestClock.adjust(Duration.millis(500));
        assert.equal(yield* Queue.take(starts), 2);
      }).pipe(Effect.provide(Layer.merge(TestClock.layer(), layer)));
    });
  });
});
