import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

const lock = Effect.runSync(Semaphore.make(1));

export function withTextAttachmentMutationLock<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return lock.withPermits(1)(effect);
}
