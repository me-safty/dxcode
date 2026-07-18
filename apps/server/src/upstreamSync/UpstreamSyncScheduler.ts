import { UPSTREAM_STARTUP_DELAY_SECONDS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerSettings from "../serverSettings.ts";
import { UpstreamIntegration } from "./UpstreamIntegration.ts";

export const upstreamBackoff = (failureCount: number): Duration.Duration => {
  if (failureCount <= 1) return Duration.minutes(15);
  if (failureCount === 2) return Duration.hours(1);
  return Duration.hours(6);
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const integration = yield* UpstreamIntegration;
    const settings = yield* ServerSettings.ServerSettingsService;
    const failures = yield* Ref.make(0);

    const checkThenWait = (reason: "startup" | "poll") =>
      integration.check(reason).pipe(
        Effect.matchEffect({
          onFailure: () =>
            Ref.updateAndGet(failures, (count) => count + 1).pipe(
              Effect.flatMap((count) => Effect.sleep(upstreamBackoff(count))),
            ),
          onSuccess: () =>
            Effect.gen(function* () {
              yield* Ref.set(failures, 0);
              const current = yield* settings.getSettings;
              yield* Effect.sleep(Duration.hours(current.upstreamSync.checkIntervalHours));
            }).pipe(Effect.catch(() => Effect.sleep(Duration.hours(12)))),
        }),
      );

    yield* Effect.sleep(Duration.seconds(UPSTREAM_STARTUP_DELAY_SECONDS)).pipe(
      Effect.andThen(checkThenWait("startup")),
      Effect.andThen(Effect.forever(checkThenWait("poll"))),
      Effect.forkScoped,
    );
  }),
);
