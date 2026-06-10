import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS checkpoint_turn_file_snapshots (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      path TEXT NOT NULL,
      blob_sha TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, turn_id, path)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_turn_file_snapshots_thread_turn
    ON checkpoint_turn_file_snapshots(thread_id, turn_id)
  `;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;
  if (!columns.some((column) => column.name === "checkpoint_attribution")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN checkpoint_attribution TEXT
    `;
  }
});
