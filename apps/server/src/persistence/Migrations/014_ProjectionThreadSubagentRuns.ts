import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN thread_kind TEXT NOT NULL DEFAULT 'primary'
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN parent_thread_id TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_runs (
      run_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      subagent_thread_id TEXT,
      skill_id TEXT NOT NULL,
      skill_title TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      report_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      accepted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_runs_parent_thread
    ON projection_thread_subagent_runs(parent_thread_id, created_at)
  `;
});
