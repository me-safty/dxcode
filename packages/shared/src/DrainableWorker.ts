/**
 * DrainableWorker - A queue-based worker that exposes a `drain()` effect.
 *
 * Wraps the common `Queue.unbounded` + `Effect.forever` pattern and adds
 * a signal that resolves when the queue is empty **and** the current item
 * has finished processing. This lets tests replace timing-sensitive
 * `Effect.sleep` calls with deterministic `drain()`.
 *
 * @module DrainableWorker
 */
import type { Scope } from "effect";
import { Deferred, Effect, Queue, Ref } from "effect";

export interface DrainableWorker<A> {
  /**
   * Enqueue a work item and track it for `drain()`.
   *
   * This wraps `Queue.offer` so drain state is updated atomically with the
   * enqueue path instead of inferring it from queue internals.
   */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * Create a drainable worker that processes items from an unbounded queue.
 *
 * The worker is forked into the current scope and will be interrupted when
 * the scope closes. A finalizer shuts down the queue.
 *
 * @param process - The effect to run for each queued item.
 * @returns A `DrainableWorker` with `queue` and `drain`.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(Queue.unbounded<A>(), Queue.shutdown);
    const outstanding = yield* Ref.make(0);
    const waiters = yield* Ref.make<Deferred.Deferred<void>[]>([]);

    const notifyWaiters = Effect.gen(function* () {
      const n = yield* Ref.get(outstanding);
      if (n <= 0) {
        const pending = yield* Ref.getAndSet(waiters, []);
        yield* Effect.forEach(pending, (d) => Deferred.succeed(d, undefined), {
          discard: true,
        });
      }
    });

    yield* Queue.take(queue).pipe(
      Effect.tap((a) =>
        Effect.ensuring(
          process(a),
          Ref.update(outstanding, (n) => n - 1).pipe(Effect.tap(() => notifyWaiters)),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const drain: DrainableWorker<A>["drain"] = Effect.gen(function* () {
      const n = yield* Ref.get(outstanding);
      if (n <= 0) return;
      const d = yield* Deferred.make<void>();
      yield* Ref.update(waiters, (ws) => [...ws, d]);
      const currentN = yield* Ref.get(outstanding);
      if (currentN <= 0) {
        yield* Deferred.succeed(d, undefined);
      }
      yield* Deferred.await(d);
    });

    const enqueue = (element: A): Effect.Effect<void> =>
      Ref.update(outstanding, (n) => n + 1).pipe(Effect.tap(() => Queue.offer(queue, element)));

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
