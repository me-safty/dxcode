import { JiraKey, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionThreadJiraRepository } from "../Services/ProjectionThreadJira.ts";
import { ProjectionThreadJiraRepositoryLive } from "./ProjectionThreadJira.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadJiraRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadJiraRepository", (it) => {
  it.effect("upserts, reads, lists, and deletes a thread's Jira key", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadJiraRepository;
      const threadId = ThreadId.make("thread-jira-1");

      assert.isTrue(Option.isNone(yield* repository.getByThreadId({ threadId })));

      yield* repository.upsert({
        threadId,
        jiraKey: JiraKey.make("PLAT-123"),
        updatedAt: "2026-06-18T10:00:00.000Z",
      });

      const stored = yield* repository.getByThreadId({ threadId });
      assert.isTrue(Option.isSome(stored));
      assert.strictEqual(Option.getOrThrow(stored).jiraKey, "PLAT-123");

      // Upsert overwrites the existing key.
      yield* repository.upsert({
        threadId,
        jiraKey: JiraKey.make("PLAT-456"),
        updatedAt: "2026-06-18T11:00:00.000Z",
      });
      const updated = yield* repository.getByThreadId({ threadId });
      assert.strictEqual(Option.getOrThrow(updated).jiraKey, "PLAT-456");

      const all = yield* repository.listAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]?.threadId, threadId);

      yield* repository.deleteByThreadId({ threadId });
      assert.isTrue(Option.isNone(yield* repository.getByThreadId({ threadId })));
      assert.strictEqual((yield* repository.listAll()).length, 0);
    }),
  );
});
