// EMPOWERRD: fork-owned migration. Tracked in a SEPARATE table ("fork_migrations")
// so its id never collides with — or blocks — upstream's effect_sql_migrations
// max-id pointer. See ForkMigrations.ts and the fenced edit in Migrations.ts.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_jira (
      thread_id TEXT PRIMARY KEY,
      jira_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
