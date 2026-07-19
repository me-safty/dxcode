import {
  DX_REMOTE_CHECK_INTERVAL_HOURS,
  DX_REMOTE_STARTUP_DELAY_SECONDS,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { DxLocalUpdate } from "./DxLocalUpdate.ts";

export const dxUpdateBackoff = (failureCount: number): Duration.Duration => {
  if (failureCount <= 1) return Duration.minutes(15);
  if (failureCount === 2) return Duration.hours(1);
  return Duration.hours(6);
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const updates = yield* DxLocalUpdate;
    const failures = yield* Ref.make(0);
    const checkThenWait = (reason: "startup" | "poll") =>
      updates.check(reason).pipe(
        Effect.matchEffect({
          onFailure: () =>
            Ref.updateAndGet(failures, (count) => count + 1).pipe(
              Effect.flatMap((count) => Effect.sleep(dxUpdateBackoff(count))),
            ),
          onSuccess: () =>
            Ref.set(failures, 0).pipe(
              Effect.andThen(Effect.sleep(Duration.hours(DX_REMOTE_CHECK_INTERVAL_HOURS))),
            ),
        }),
      );

    yield* Effect.sleep(Duration.seconds(DX_REMOTE_STARTUP_DELAY_SECONDS)).pipe(
      Effect.andThen(checkThenWait("startup")),
      Effect.andThen(Effect.forever(checkThenWait("poll"))),
      Effect.forkScoped,
    );
  }),
);
