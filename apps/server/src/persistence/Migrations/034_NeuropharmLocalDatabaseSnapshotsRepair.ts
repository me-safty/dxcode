import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_local_database_snapshots (
      source TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      download_url TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT NOT NULL,
      version TEXT,
      downloaded_at TEXT,
      imported_at TEXT,
      bytes REAL,
      row_count INTEGER NOT NULL,
      checksum_sha256 TEXT,
      error TEXT
    )
  `;
});
