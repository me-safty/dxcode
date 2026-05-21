import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_evidence (
      evidence_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      citation TEXT,
      snippet TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_evidence_source
    ON neuropharm_evidence(source, imported_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_evidence_title
    ON neuropharm_evidence(title)
  `;
});
