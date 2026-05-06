import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { makeDesktopShutdown } from "./desktopShutdown.ts";

describe("DesktopShutdown", () => {
  it.effect("unblocks request waiters when shutdown is requested", () =>
    Effect.gen(function* () {
      const shutdown = yield* makeDesktopShutdown;
      const waiter = yield* shutdown.awaitRequest.pipe(Effect.as("requested"), Effect.forkChild);

      yield* shutdown.request;

      assert.equal(yield* Fiber.join(waiter), "requested");
    }),
  );

  it.effect("tracks completion after resources finish closing", () =>
    Effect.gen(function* () {
      const shutdown = yield* makeDesktopShutdown;
      const waiter = yield* shutdown.awaitComplete.pipe(Effect.as("complete"), Effect.forkChild);

      assert.equal(yield* shutdown.isComplete, false);
      yield* shutdown.markComplete;

      assert.equal(yield* shutdown.isComplete, true);
      assert.equal(yield* Fiber.join(waiter), "complete");
    }),
  );

  it.effect("allows repeated requests and completion marks", () =>
    Effect.gen(function* () {
      const shutdown = yield* makeDesktopShutdown;

      yield* shutdown.request;
      yield* shutdown.request;
      yield* shutdown.markComplete;
      yield* shutdown.markComplete;

      assert.equal(yield* shutdown.isComplete, true);
    }),
  );
});
