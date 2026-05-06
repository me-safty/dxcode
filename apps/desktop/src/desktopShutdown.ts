import { Context, Deferred, Effect, Ref } from "effect";

export interface DesktopShutdownShape {
  readonly request: Effect.Effect<void>;
  readonly awaitRequest: Effect.Effect<void>;
  readonly markComplete: Effect.Effect<void>;
  readonly awaitComplete: Effect.Effect<void>;
  readonly isComplete: Effect.Effect<boolean>;
}

export class DesktopShutdown extends Context.Service<DesktopShutdown, DesktopShutdownShape>()(
  "t3/desktop/Shutdown",
) {}

export const makeDesktopShutdown = Effect.gen(function* () {
  const requested = yield* Deferred.make<void>();
  const completed = yield* Deferred.make<void>();
  const completedRef = yield* Ref.make(false);

  return DesktopShutdown.of({
    request: Deferred.succeed(requested, undefined).pipe(Effect.asVoid),
    awaitRequest: Deferred.await(requested),
    markComplete: Ref.set(completedRef, true).pipe(
      Effect.andThen(Deferred.succeed(completed, undefined)),
      Effect.asVoid,
    ),
    awaitComplete: Deferred.await(completed),
    isComplete: Ref.get(completedRef),
  });
});
