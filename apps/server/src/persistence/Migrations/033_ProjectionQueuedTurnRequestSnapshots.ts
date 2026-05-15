import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_queued_turns
    ADD COLUMN request_json TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_queued_turns_next (
      queue_item_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    DELETE FROM projection_queued_turns_next
  `;

  yield* sql`
    INSERT INTO projection_queued_turns_next (
      queue_item_id,
      thread_id,
      request_json,
      status,
      failure_reason,
      created_at,
      updated_at
    )
    SELECT
      queue_item_id,
      thread_id,
      request_json,
      CASE status
        WHEN 'accepted' THEN 'sending'
        ELSE status
      END,
      failure_reason,
      created_at,
      updated_at
    FROM projection_queued_turns
    WHERE request_json IS NOT NULL
  `;

  yield* sql`
    DROP TABLE projection_queued_turns
  `;

  yield* sql`
    ALTER TABLE projection_queued_turns_next
    RENAME TO projection_queued_turns
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_queued_turns_thread_status_created
    ON projection_queued_turns(thread_id, status, created_at)
  `;
});
