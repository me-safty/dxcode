import { Effect, Ref } from "effect";
import * as Semaphore from "effect/Semaphore";

export interface ProviderMaintenanceCommandCoordinatorShape<E> {
  readonly withCommandLock: <A, R>(input: {
    readonly targetKey: string;
    readonly lockKey: string;
    readonly run: Effect.Effect<A, E, R>;
  }) => Effect.Effect<A, E, R>;
}

export const makeProviderMaintenanceCommandCoordinator = Effect.fn(
  "makeProviderMaintenanceCommandCoordinator",
)(function* <E>(input: {
  readonly lockKeys: ReadonlyArray<string>;
  readonly makeAlreadyRunningError: (targetKey: string) => E;
  readonly makeUnsupportedLockError: (lockKey: string) => E;
}) {
  const runningTargetsRef = yield* Ref.make<ReadonlySet<string>>(new Set());
  const locks = new Map<string, Semaphore.Semaphore>(
    yield* Effect.forEach(input.lockKeys, (lockKey) =>
      Semaphore.make(1).pipe(Effect.map((semaphore) => [lockKey, semaphore] as const)),
    ),
  );

  const acquireTarget = Effect.fn("acquireTarget")(function* (targetKey: string) {
    return yield* Ref.modify(runningTargetsRef, (runningTargets) => {
      if (runningTargets.has(targetKey)) {
        return [false, runningTargets] as const;
      }
      const next = new Set(runningTargets);
      next.add(targetKey);
      return [true, next] as const;
    });
  });

  const releaseTarget = (targetKey: string) =>
    Ref.update(runningTargetsRef, (runningTargets) => {
      const next = new Set(runningTargets);
      next.delete(targetKey);
      return next;
    });

  const withCommandLock: ProviderMaintenanceCommandCoordinatorShape<E>["withCommandLock"] = ({
    targetKey,
    lockKey,
    run,
  }) =>
    Effect.gen(function* () {
      const acquired = yield* acquireTarget(targetKey);
      if (!acquired) {
        return yield* Effect.fail(input.makeAlreadyRunningError(targetKey));
      }

      return yield* Effect.gen(function* () {
        const lock = locks.get(lockKey);
        if (!lock) {
          return yield* Effect.fail(input.makeUnsupportedLockError(lockKey));
        }
        return yield* lock.withPermits(1)(run);
      }).pipe(Effect.ensuring(releaseTarget(targetKey)));
    });

  return {
    withCommandLock,
  } satisfies ProviderMaintenanceCommandCoordinatorShape<E>;
});
