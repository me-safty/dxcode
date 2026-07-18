import { it } from "@effect/vitest";
import { ProviderInstanceId, ReviewStackSnapshotId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { expect } from "vite-plus/test";

import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import * as Repository from "./Repository.ts";

const layer = it.layer(Repository.layer.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())));

layer("ReviewStackRepository", (it) => {
  it.effect("orders history, reuses newest hash, and rejects duplicate in-flight rows", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 33 });
      const repository = yield* Repository.ReviewStackRepository;
      const threadId = ThreadId.make("thread-review-stack");
      const firstId = ReviewStackSnapshotId.make("snapshot-1");
      const secondId = ReviewStackSnapshotId.make("snapshot-2");
      const base = {
        threadId,
        scopeKey: "working-tree:head:false",
        target: { _tag: "working-tree" as const },
        sourceHash: "source-hash",
        sourceDiff: "diff --git a/a.ts b/a.ts",
        anchorCatalog: [],
        sourceTruncated: false,
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-terra",
        },
        instructions: "",
      };

      yield* repository.insert({
        ...base,
        snapshotId: firstId,
        createdAt: "2026-07-18T00:00:00.000Z",
      });
      const duplicate = yield* repository
        .insert({
          ...base,
          snapshotId: secondId,
          createdAt: "2026-07-18T00:00:01.000Z",
        })
        .pipe(Effect.result);
      expect(Result.isFailure(duplicate)).toBe(true);

      yield* repository.update({
        snapshotId: firstId,
        status: "completed",
        stage: "completed",
        review: { summary: "First", layers: [] },
        completedAt: "2026-07-18T00:00:02.000Z",
        updatedAt: "2026-07-18T00:00:02.000Z",
      });
      yield* repository.insert({
        ...base,
        snapshotId: secondId,
        createdAt: "2026-07-18T00:00:03.000Z",
      });
      yield* repository.update({
        snapshotId: secondId,
        status: "completed",
        stage: "completed",
        review: { summary: "Second", layers: [] },
        completedAt: "2026-07-18T00:00:04.000Z",
        updatedAt: "2026-07-18T00:00:04.000Z",
      });

      const history = yield* repository.list(threadId, base.scopeKey);
      expect(history.map(({ snapshotId }) => snapshotId)).toEqual([secondId, firstId]);
      expect(
        (yield* repository.findReusable(threadId, base.scopeKey, base.sourceHash))?.metadata
          .snapshotId,
      ).toBe(secondId);
    }),
  );
});
