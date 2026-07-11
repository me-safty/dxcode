import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CheckpointServiceV2 } from "./CheckpointService.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";

export class CheckpointCleanupError extends Schema.TaggedErrorClass<CheckpointCleanupError>()(
  "CheckpointCleanupError",
  {
    threadId: ThreadId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean checkpoint refs for thread ${this.threadId}.`;
  }
}

export class CheckpointCleanupServiceV2 extends Context.Service<
  CheckpointCleanupServiceV2,
  {
    readonly cleanup: (threadId: ThreadId) => Effect.Effect<void, CheckpointCleanupError>;
  }
>()("t3/orchestration-v2/CheckpointCleanupService/CheckpointCleanupServiceV2") {}

export const layer: Layer.Layer<
  CheckpointCleanupServiceV2,
  never,
  CheckpointServiceV2 | ProjectionStoreV2
> = Layer.effect(
  CheckpointCleanupServiceV2,
  Effect.gen(function* () {
    const checkpoints = yield* CheckpointServiceV2;
    const projections = yield* ProjectionStoreV2;

    const cleanup = Effect.fn("orchestrationV2.checkpointCleanup.cleanup")(function* (
      threadId: ThreadId,
    ) {
      const projection = yield* projections.getThreadProjection(threadId);
      const throughOrdinal = Math.max(
        0,
        ...projection.runs.map((run) => run.ordinal),
        ...projection.checkpoints.map((checkpoint) => checkpoint.ordinalWithinScope),
      );

      yield* Effect.forEach(
        projection.checkpointScopes,
        (scope) =>
          checkpoints.deleteScopeRefs({
            scope,
            checkpoints: projection.checkpoints.filter(
              (checkpoint) => checkpoint.scopeId === scope.id,
            ),
            throughOrdinal,
          }),
        { concurrency: 1, discard: true },
      );
    });

    return CheckpointCleanupServiceV2.of({
      cleanup: (threadId) =>
        cleanup(threadId).pipe(
          Effect.mapError((cause) => new CheckpointCleanupError({ threadId, cause })),
        ),
    });
  }),
);
