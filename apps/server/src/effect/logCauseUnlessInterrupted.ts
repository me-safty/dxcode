import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

type CauseLogLevel = "Debug" | "Warning" | "Error";

export function ignoreCauseUnlessInterrupted<R, E>(
  effect: Effect.Effect<unknown, E, R>,
  options: {
    readonly message: string;
    readonly level?: CauseLogLevel;
    readonly fields?: Record<string, unknown>;
  },
): Effect.Effect<void, never, R> {
  const logFields = (cause: Cause.Cause<E>) => ({
    ...options.fields,
    cause: Cause.pretty(cause),
  });
  const logCause = (cause: Cause.Cause<E>) => {
    switch (options.level ?? "Warning") {
      case "Debug":
        return Effect.logDebug(options.message, logFields(cause));
      case "Error":
        return Effect.logError(options.message, logFields(cause));
      case "Warning":
        return Effect.logWarning(options.message, logFields(cause));
    }
  };

  return effect.pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : logCause(cause)),
      onSuccess: () => Effect.void,
    }),
  );
}
