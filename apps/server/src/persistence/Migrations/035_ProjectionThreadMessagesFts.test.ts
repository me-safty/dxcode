import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const TS = "2026-01-01T00:00:00.000Z";

const upsertMessage = (
  sql: SqlClient.SqlClient,
  row: {
    readonly messageId: string;
    readonly threadId: string;
    readonly role: string;
    readonly text: string;
    readonly isStreaming: 0 | 1;
  },
) =>
  sql`
    INSERT INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
    ) VALUES (
      ${row.messageId}, ${row.threadId}, ${null}, ${row.role}, ${row.text},
      ${row.isStreaming}, ${TS}, ${TS}
    )
    ON CONFLICT (message_id) DO UPDATE SET
      text = excluded.text,
      is_streaming = excluded.is_streaming
  `;

const matchThreadIds = (sql: SqlClient.SqlClient, query: string) =>
  sql<{ readonly thread_id: string }>`
    SELECT thread_id FROM projection_thread_messages_fts
    WHERE projection_thread_messages_fts MATCH ${query}
    ORDER BY thread_id
  `.pipe(Effect.map((rows) => rows.map((row) => row.thread_id)));

layer("035_ProjectionThreadMessagesFts", (it) => {
  it.effect("backfills existing finalized messages and keeps the index in sync", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Apply everything up to (but not including) the FTS migration, then seed
      // pre-existing messages so we can prove the backfill picks them up.
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* upsertMessage(sql, {
        messageId: "m1",
        threadId: "t1",
        role: "user",
        text: "the quick brown fox",
        isStreaming: 0,
      });
      yield* upsertMessage(sql, {
        messageId: "m2",
        threadId: "t2",
        role: "assistant",
        text: "a lazy dog sleeps",
        isStreaming: 0,
      });
      yield* upsertMessage(sql, {
        messageId: "m3",
        threadId: "t3",
        role: "assistant",
        text: "streaming partial elephant",
        isStreaming: 1,
      });

      yield* runMigrations({ toMigrationInclusive: 35 });

      // Backfill: finalized messages searchable across both roles; the streaming
      // one is not indexed yet.
      assert.deepStrictEqual(yield* matchThreadIds(sql, "quick"), ["t1"]);
      assert.deepStrictEqual(yield* matchThreadIds(sql, "lazy"), ["t2"]);
      assert.deepStrictEqual(yield* matchThreadIds(sql, "elephant"), []);

      // Live insert of a finalized message is indexed by the trigger.
      yield* upsertMessage(sql, {
        messageId: "m4",
        threadId: "t4",
        role: "user",
        text: "a fresh zebra appears",
        isStreaming: 0,
      });
      assert.deepStrictEqual(yield* matchThreadIds(sql, "zebra"), ["t4"]);

      // Finalizing the streaming message (upsert with is_streaming = 0) indexes it.
      yield* upsertMessage(sql, {
        messageId: "m3",
        threadId: "t3",
        role: "assistant",
        text: "streaming partial elephant",
        isStreaming: 0,
      });
      assert.deepStrictEqual(yield* matchThreadIds(sql, "elephant"), ["t3"]);

      // Deleting a message removes it from the index.
      yield* sql`DELETE FROM projection_thread_messages WHERE message_id = ${"m1"}`;
      assert.deepStrictEqual(yield* matchThreadIds(sql, "quick"), []);

      // Prefix search works (FTS5 token prefix).
      assert.deepStrictEqual(yield* matchThreadIds(sql, "zeb*"), ["t4"]);
    }),
  );
});
