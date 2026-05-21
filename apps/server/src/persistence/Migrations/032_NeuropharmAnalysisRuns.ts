import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_analysis_runs (
      analysis_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      query TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      result_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_analysis_runs_mode
    ON neuropharm_analysis_runs(mode, generated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_analysis_runs_query
    ON neuropharm_analysis_runs(query)
  `;
});
