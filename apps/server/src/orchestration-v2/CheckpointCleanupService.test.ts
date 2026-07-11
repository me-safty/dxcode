import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CheckpointCleanupServiceV2, layer } from "./CheckpointCleanupService.ts";
import { CheckpointServiceV2 } from "./CheckpointService.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";

it.effect("cleans every checkpoint scope through the latest known ordinal", () => {
  const threadId = ThreadId.make("thread_checkpoint_cleanup");
  const firstScope = {
    id: CheckpointScopeId.make("scope_first"),
    threadId,
  } as OrchestrationV2CheckpointScope;
  const secondScope = {
    id: CheckpointScopeId.make("scope_second"),
    threadId,
  } as OrchestrationV2CheckpointScope;
  const checkpoint = {
    id: CheckpointId.make("checkpoint_first"),
    scopeId: firstScope.id,
    ordinalWithinScope: 2,
    ref: CheckpointRef.make("refs/t3/test/checkpoint-first"),
  } as OrchestrationV2Checkpoint;
  const projection = {
    thread: { id: threadId },
    runs: [{ ordinal: 4 }],
    checkpointScopes: [firstScope, secondScope],
    checkpoints: [checkpoint],
  } as unknown as OrchestrationV2ThreadProjection;
  const calls: Array<{
    readonly scopeId: CheckpointScopeId;
    readonly checkpointIds: ReadonlyArray<CheckpointId>;
    readonly throughOrdinal: number;
  }> = [];
  const testLayer = layer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.mock(ProjectionStoreV2)({
          getThreadProjection: () => Effect.succeed(projection),
        }),
        Layer.mock(CheckpointServiceV2)({
          deleteScopeRefs: (input) => {
            calls.push({
              scopeId: input.scope.id,
              checkpointIds: input.checkpoints.map((item) => item.id),
              throughOrdinal: input.throughOrdinal,
            });
            return Effect.void;
          },
        }),
      ),
    ),
  );

  return Effect.gen(function* () {
    const cleanup = yield* CheckpointCleanupServiceV2;
    yield* cleanup.cleanup(threadId);

    assert.deepEqual(calls, [
      {
        scopeId: firstScope.id,
        checkpointIds: [checkpoint.id],
        throughOrdinal: 4,
      },
      {
        scopeId: secondScope.id,
        checkpointIds: [],
        throughOrdinal: 4,
      },
    ]);
  }).pipe(Effect.provide(testLayer));
});
