import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { runWorkflowRuntimeService } from "./index.ts";
import { WorkflowGitHubPoller } from "./workflow/Services/WorkflowGitHubPoller.ts";
import { WorkflowRecovery } from "./workflow/Services/WorkflowRecovery.ts";

const IdlePollerLayer = Layer.succeed(WorkflowGitHubPoller, {
  sweep: () =>
    Effect.succeed({
      observedTickets: 0,
      recordedObservations: 0,
      appliedObservations: 0,
      failedTickets: 0,
    }),
  start: () => Effect.void,
} satisfies WorkflowGitHubPoller["Service"]);

it.effect("workflow runtime service runs recovery once and closes daemon scope on interrupt", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const recovered = yield* Deferred.make<void>();
    const runtimeReady = yield* Deferred.make<
      Context.Context<WorkflowRecovery | WorkflowGitHubPoller>,
      Error
    >();
    const stopped = yield* Deferred.make<void>();
    let recoverCount = 0;

    const appLayer = Layer.effect(
      WorkflowRecovery,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        events.push("daemon-start");
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            events.push("daemon-stop");
          }).pipe(Effect.andThen(Deferred.succeed(stopped, undefined))),
        );
        return {
          recover: () =>
            Effect.sync(() => {
              recoverCount += 1;
              events.push("recover");
            }).pipe(Effect.andThen(Deferred.succeed(recovered, undefined))),
        } satisfies WorkflowRecovery["Service"];
      }),
    );

    const appLayerWithPoller = appLayer.pipe(Layer.provideMerge(IdlePollerLayer));
    const fiber = yield* runWorkflowRuntimeService(appLayerWithPoller, runtimeReady).pipe(
      Effect.forkChild,
    );
    yield* Deferred.await(recovered);
    yield* Deferred.await(runtimeReady);

    assert.equal(recoverCount, 1);
    assert.deepEqual(events, ["daemon-start", "recover"]);

    yield* Fiber.interrupt(fiber);
    yield* Deferred.await(stopped);

    assert.deepEqual(events, ["daemon-start", "recover", "daemon-stop"]);
  }),
);

it.effect("workflow runtime service starts the GitHub poller only after recovery", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const recovered = yield* Deferred.make<void>();
    const runtimeReady = yield* Deferred.make<
      Context.Context<WorkflowRecovery | WorkflowGitHubPoller>,
      Error
    >();

    const appLayer = Layer.mergeAll(
      Layer.succeed(WorkflowRecovery, {
        recover: () =>
          Effect.sync(() => {
            events.push("recover");
          }).pipe(Effect.andThen(Deferred.succeed(recovered, undefined))),
      } satisfies WorkflowRecovery["Service"]),
      Layer.succeed(WorkflowGitHubPoller, {
        sweep: () =>
          Effect.succeed({
            observedTickets: 0,
            recordedObservations: 0,
            appliedObservations: 0,
            failedTickets: 0,
          }),
        start: () =>
          Effect.gen(function* () {
            const scope = yield* Scope.Scope;
            events.push("poller-start");
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                events.push("poller-stop");
              }),
            );
          }),
      } satisfies WorkflowGitHubPoller["Service"]),
    );

    const buildScope = yield* Scope.make();
    yield* Layer.buildWithScope(appLayer, buildScope);
    assert.deepEqual(events, []);
    yield* Scope.close(buildScope, Exit.void);

    const fiber = yield* runWorkflowRuntimeService(appLayer, runtimeReady).pipe(Effect.forkChild);
    yield* Effect.gen(function* () {
      yield* Deferred.await(recovered);
      yield* Deferred.await(runtimeReady);
      yield* Effect.yieldNow;
      assert.deepEqual(events, ["recover", "poller-start"]);

      yield* Fiber.interrupt(fiber);
      assert.deepEqual(events, ["recover", "poller-start", "poller-stop"]);
    }).pipe(Effect.ensuring(Fiber.interrupt(fiber)));
  }),
);

it.effect(
  "fails runtimeReady instead of hanging when boot dies with a defect during recovery",
  () =>
    Effect.gen(function* () {
      // A defect (not a typed failure) during boot must still complete
      // `runtimeReady` — otherwise every handler awaiting it hangs forever.
      // `Effect.retry` does not retry defects, so this resolves immediately.
      const runtimeReady = yield* Deferred.make<
        Context.Context<WorkflowRecovery | WorkflowGitHubPoller>,
        Error
      >();
      const appLayer = Layer.mergeAll(
        Layer.succeed(WorkflowRecovery, {
          recover: () => Effect.die(new Error("recovery defect")),
        } satisfies WorkflowRecovery["Service"]),
        IdlePollerLayer,
      );

      const fiber = yield* runWorkflowRuntimeService(appLayer, runtimeReady).pipe(Effect.forkChild);
      const exit = yield* Deferred.await(runtimeReady).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      yield* Fiber.interrupt(fiber);
    }),
);
