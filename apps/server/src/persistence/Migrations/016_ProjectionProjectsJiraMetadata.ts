import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Jira metadata fields
  yield* sql`ALTER TABLE projection_projects ADD COLUMN ticket_key TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN jira_status TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN priority TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN jira_url TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN components_json TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN labels_json TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN assignee TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN reporter TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN description TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN parent_key TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN suggested_repo TEXT`;

  // User note
  yield* sql`ALTER TABLE projection_projects ADD COLUMN note TEXT`;

  // Access tracking
  yield* sql`ALTER TABLE projection_projects ADD COLUMN last_accessed_at TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN archived_at TEXT`;
});
