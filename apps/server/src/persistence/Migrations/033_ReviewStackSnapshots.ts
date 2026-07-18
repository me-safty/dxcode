import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE review_stack_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_diff TEXT NOT NULL,
      anchor_catalog_json TEXT NOT NULL,
      source_truncated INTEGER NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      instructions TEXT NOT NULL,
      review_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX idx_review_stack_scope_history
    ON review_stack_snapshots(thread_id, scope_key, created_at DESC)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_review_stack_inflight
    ON review_stack_snapshots(thread_id, scope_key, source_hash)
    WHERE status IN ('queued', 'running')
  `;
});
