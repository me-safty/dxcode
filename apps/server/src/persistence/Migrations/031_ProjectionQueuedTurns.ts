import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_queued_turns (
      queue_item_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      model_selection_json TEXT,
      title_seed TEXT,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      status TEXT NOT NULL,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_queued_turns_thread_status_created
    ON projection_queued_turns(thread_id, status, created_at)
  `;
});
