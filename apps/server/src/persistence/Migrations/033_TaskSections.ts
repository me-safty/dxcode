import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN context_markdown TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE projection_threads ADD COLUMN section_context_json TEXT`;
});
