import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_queued_turns (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      model_selection_json TEXT,
      title_seed TEXT,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES projection_threads(thread_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_queued_turns_thread_created
    ON projection_thread_queued_turns(thread_id, created_at, message_id)
  `;
});
