import type { DesktopBackendBootstrap } from "@t3tools/contracts";
import {
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Ref,
  Scope,
  Semaphore,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  runBackendProcess,
  type BackendProcessExit,
  type RunBackendProcessOptions,
} from "./backendProcess.ts";
import type { BackendTimeoutError } from "./backendReadiness.ts";

const INITIAL_RESTART_DELAY = Duration.millis(500);
const MAX_RESTART_DELAY = Duration.seconds(10);

type BackendRunnerRequirements =
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | Scope.Scope;

export interface DesktopBackendStartConfig {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly bootstrap: DesktopBackendBootstrap;
  readonly httpBaseUrl: URL;
  readonly captureOutput: boolean;
}

export interface DesktopBackendSnapshot {
  readonly desiredRunning: boolean;
  readonly ready: boolean;
  readonly activePid: Option.Option<number>;
  readonly restartAttempt: number;
  readonly restartScheduled: boolean;
  readonly shuttingDown: boolean;
}

export interface DesktopBackendProcessRunnerShape {
  readonly run: (
    options: RunBackendProcessOptions,
  ) => Effect.Effect<BackendProcessExit, unknown, BackendRunnerRequirements>;
}

export class DesktopBackendProcessRunner extends Context.Service<
  DesktopBackendProcessRunner,
  DesktopBackendProcessRunnerShape
>()("t3/desktop/BackendProcessRunner") {}

export const DesktopBackendProcessRunnerLive = Layer.succeed(DesktopBackendProcessRunner, {
  run: runBackendProcess,
} satisfies DesktopBackendProcessRunnerShape);

export interface DesktopBackendConfigurationShape {
  readonly resolve: Effect.Effect<DesktopBackendStartConfig, never, FileSystem.FileSystem>;
}

export class DesktopBackendConfiguration extends Context.Service<
  DesktopBackendConfiguration,
  DesktopBackendConfigurationShape
>()("t3/desktop/BackendConfiguration") {}

export interface DesktopBackendEventsShape {
  readonly onStarting: Effect.Effect<void>;
  readonly onStarted: (input: {
    readonly pid: number;
    readonly config: DesktopBackendStartConfig;
  }) => Effect.Effect<void>;
  readonly onReady: Effect.Effect<void>;
  readonly onReadinessFailure: (error: BackendTimeoutError) => Effect.Effect<void>;
  readonly onOutput: (streamName: "stdout" | "stderr", chunk: Uint8Array) => Effect.Effect<void>;
  readonly onExit: (input: {
    readonly pid: Option.Option<number>;
    readonly reason: string;
  }) => Effect.Effect<void>;
  readonly onRestartScheduled: (input: {
    readonly reason: string;
    readonly delay: Duration.Duration;
  }) => Effect.Effect<void>;
}

export class DesktopBackendEvents extends Context.Service<
  DesktopBackendEvents,
  DesktopBackendEventsShape
>()("t3/desktop/BackendEvents") {}

export const DesktopBackendEventsSilent = Layer.succeed(DesktopBackendEvents, {
  onStarting: Effect.void,
  onStarted: () => Effect.void,
  onReady: Effect.void,
  onReadinessFailure: () => Effect.void,
  onOutput: () => Effect.void,
  onExit: () => Effect.void,
  onRestartScheduled: () => Effect.void,
} satisfies DesktopBackendEventsShape);

export interface DesktopBackendManagerShape {
  readonly start: Effect.Effect<void>;
  readonly stop: (options?: { readonly timeout?: Duration.Duration }) => Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
  readonly snapshot: Effect.Effect<DesktopBackendSnapshot>;
}

export class DesktopBackendManager extends Context.Service<
  DesktopBackendManager,
  DesktopBackendManagerShape
>()("t3/desktop/BackendManager") {}

interface ActiveBackendRun {
  readonly id: number;
  readonly scope: Scope.Closeable;
  readonly fiber: Option.Option<Fiber.Fiber<void, never>>;
  readonly pid: Option.Option<number>;
}

interface BackendManagerState {
  readonly desiredRunning: boolean;
  readonly ready: boolean;
  readonly active: Option.Option<ActiveBackendRun>;
  readonly restartAttempt: number;
  readonly restartFiber: Option.Option<Fiber.Fiber<void, never>>;
  readonly nextRunId: number;
  readonly shuttingDown: boolean;
}

const initialState: BackendManagerState = {
  desiredRunning: false,
  ready: false,
  active: Option.none(),
  restartAttempt: 0,
  restartFiber: Option.none(),
  nextRunId: 1,
  shuttingDown: false,
};

const activePid = (active: Option.Option<ActiveBackendRun>): Option.Option<number> =>
  Option.flatMap(active, (run) => run.pid);

const withActiveRun =
  (runId: number, f: (run: ActiveBackendRun) => ActiveBackendRun) =>
  (state: BackendManagerState): BackendManagerState => ({
    ...state,
    active: Option.map(state.active, (run) => (run.id === runId ? f(run) : run)),
  });

const calculateRestartDelay = (attempt: number): Duration.Duration =>
  Duration.min(Duration.times(INITIAL_RESTART_DELAY, 2 ** attempt), MAX_RESTART_DELAY);

const closeRun = (
  run: ActiveBackendRun,
  options?: { readonly timeout?: Duration.Duration },
): Effect.Effect<void> => {
  const waitForFiber = Option.match(run.fiber, {
    onNone: () => Effect.void,
    onSome: (fiber) => Fiber.await(fiber).pipe(Effect.asVoid),
  });
  const close = Scope.close(run.scope, Exit.void).pipe(Effect.andThen(waitForFiber));

  return (
    options?.timeout ? close.pipe(Effect.timeoutOption(options.timeout), Effect.asVoid) : close
  ).pipe(Effect.ignore);
};

export const makeDesktopBackendManager = Effect.fn("makeDesktopBackendManager")(function* () {
  const parentScope = yield* Scope.Scope;
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const configuration = yield* DesktopBackendConfiguration;
  const events = yield* DesktopBackendEvents;
  const runner = yield* DesktopBackendProcessRunner;
  const state = yield* Ref.make(initialState);
  const mutex = yield* Semaphore.make(1);

  const updateActiveRun = (runId: number, f: (run: ActiveBackendRun) => ActiveBackendRun) =>
    Ref.update(state, withActiveRun(runId, f));

  const snapshot = Ref.get(state).pipe(
    Effect.map(
      (current): DesktopBackendSnapshot => ({
        desiredRunning: current.desiredRunning,
        ready: current.ready,
        activePid: activePid(current.active),
        restartAttempt: current.restartAttempt,
        restartScheduled: Option.isSome(current.restartFiber),
        shuttingDown: current.shuttingDown,
      }),
    ),
  );

  const cancelRestart = Effect.gen(function* () {
    const restartFiber = yield* Ref.modify(state, (current) => [
      current.restartFiber,
      {
        ...current,
        restartFiber: Option.none(),
      },
    ]);

    yield* Option.match(restartFiber, {
      onNone: () => Effect.void,
      onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
    });
  });

  const start: Effect.Effect<void> = Effect.suspend(() =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (current.shuttingDown || Option.isSome(current.active)) {
          return;
        }

        yield* events.onStarting;
        const config = yield* configuration.resolve.pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        );
        const entryExists = yield* fileSystem
          .exists(config.entryPath)
          .pipe(Effect.orElseSucceed(() => false));

        yield* Ref.update(state, (latest) => ({
          ...latest,
          desiredRunning: true,
          ready: false,
          restartFiber: Option.none(),
        }));

        if (!entryExists) {
          yield* scheduleRestart(`missing server entry at ${config.entryPath}`);
          return;
        }

        const runScope = yield* Scope.make("sequential");
        const runId = yield* Ref.modify(state, (latest) => [
          latest.nextRunId,
          {
            ...latest,
            active: Option.some({
              id: latest.nextRunId,
              scope: runScope,
              fiber: Option.none(),
              pid: Option.none(),
            } satisfies ActiveBackendRun),
            nextRunId: latest.nextRunId + 1,
          },
        ]);

        const finalizeRun = (reason: string) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const { isCurrentRun, nextState, pid } = yield* Ref.modify(
                state,
                (
                  latest,
                ): readonly [
                  {
                    readonly isCurrentRun: boolean;
                    readonly nextState: BackendManagerState;
                    readonly pid: Option.Option<number>;
                  },
                  BackendManagerState,
                ] => {
                  const currentRun = Option.getOrUndefined(latest.active);
                  if (currentRun?.id !== runId) {
                    return [
                      {
                        isCurrentRun: false,
                        nextState: latest,
                        pid: Option.none<number>(),
                      },
                      latest,
                    ] as const;
                  }

                  const next = {
                    ...latest,
                    active: Option.none<ActiveBackendRun>(),
                    ready: false,
                  };
                  return [
                    {
                      isCurrentRun: true,
                      nextState: next,
                      pid: currentRun.pid,
                    },
                    next,
                  ] as const;
                },
              );

              if (isCurrentRun) {
                yield* events.onExit({
                  pid,
                  reason,
                });
              }

              if (isCurrentRun && nextState.desiredRunning && !nextState.shuttingDown) {
                yield* scheduleRestart(reason);
              }
            }),
          );

        const program = runner
          .run({
            ...config,
            onStarted: (pid) =>
              Effect.gen(function* () {
                yield* updateActiveRun(runId, (run) => ({
                  ...run,
                  pid: Option.some(pid),
                }));
                yield* Ref.update(state, (latest) => ({
                  ...latest,
                  restartAttempt: 0,
                }));
                yield* events.onStarted({ pid, config });
              }),
            onReady: () =>
              Effect.gen(function* () {
                yield* Ref.update(state, (latest) => ({
                  ...latest,
                  ready: Option.match(latest.active, {
                    onNone: () => latest.ready,
                    onSome: (run) => (run.id === runId ? true : latest.ready),
                  }),
                }));
                yield* events.onReady;
              }),
            onReadinessFailure: events.onReadinessFailure,
            onOutput: events.onOutput,
          })
          .pipe(
            Scope.provide(runScope),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.matchEffect({
              onFailure: (error) => finalizeRun(formatUnknownError(error)),
              onSuccess: (exit) => finalizeRun(exit.reason),
            }),
            Effect.ensuring(Scope.close(runScope, Exit.void).pipe(Effect.ignore)),
          );

        const fiber = yield* Effect.forkIn(program, parentScope);
        yield* updateActiveRun(runId, (run) => ({
          ...run,
          fiber: Option.some(fiber),
        }));
      }),
    ),
  );

  const scheduleRestart = (reason: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const scheduled = yield* Ref.modify(state, (latest) => {
        if (latest.shuttingDown || !latest.desiredRunning || Option.isSome(latest.restartFiber)) {
          return [Option.none<Duration.Duration>(), latest] as const;
        }

        const delay = calculateRestartDelay(latest.restartAttempt);
        return [
          Option.some(delay),
          {
            ...latest,
            restartAttempt: latest.restartAttempt + 1,
          },
        ] as const;
      });

      yield* Option.match(scheduled, {
        onNone: () => Effect.void,
        onSome: (delay) =>
          Effect.gen(function* () {
            yield* events.onRestartScheduled({ reason, delay });
            const restartFiber = yield* Effect.forkIn(
              Effect.sleep(delay).pipe(
                Effect.andThen(
                  Ref.update(state, (latest) => ({
                    ...latest,
                    restartFiber: Option.none(),
                  })),
                ),
                Effect.andThen(start),
                Effect.catchCause((cause) =>
                  Effect.logError("desktop backend restart fiber failed", { cause }),
                ),
              ),
              parentScope,
            );
            yield* Ref.update(state, (latest) =>
              Option.isNone(latest.restartFiber)
                ? {
                    ...latest,
                    restartFiber: Option.some(restartFiber),
                  }
                : latest,
            );
          }),
      });
    });

  const stop = (options?: { readonly timeout?: Duration.Duration }): Effect.Effect<void> =>
    Effect.gen(function* () {
      const { active, restartFiber } = yield* mutex.withPermits(1)(
        Ref.modify(state, (latest) => [
          {
            active: latest.active,
            restartFiber: latest.restartFiber,
          },
          {
            ...latest,
            desiredRunning: false,
            ready: false,
            active: Option.none<ActiveBackendRun>(),
            restartFiber: Option.none<Fiber.Fiber<void, never>>(),
          },
        ]),
      );

      yield* Option.match(restartFiber, {
        onNone: () => Effect.void,
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      });
      yield* Option.match(active, {
        onNone: () => Effect.void,
        onSome: (run) => closeRun(run, options),
      });
    });

  const shutdown = Effect.gen(function* () {
    yield* Ref.update(state, (latest) => ({
      ...latest,
      shuttingDown: true,
      desiredRunning: false,
    }));
    yield* cancelRestart;
    yield* stop();
  });

  yield* Scope.addFinalizer(parentScope, shutdown);

  return DesktopBackendManager.of({
    start,
    stop,
    shutdown,
    snapshot,
  });
});

export const DesktopBackendManagerLive = Layer.effect(
  DesktopBackendManager,
  makeDesktopBackendManager(),
);

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
