import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS jira_tickets (
      key TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      assignee TEXT,
      reporter TEXT,
      description TEXT,
      components_json TEXT NOT NULL DEFAULT '[]',
      labels_json TEXT NOT NULL DEFAULT '[]',
      parent_key TEXT,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS component_repo_map (
      component TEXT PRIMARY KEY,
      repo TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jira_tickets_status
    ON jira_tickets(status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_jira_tickets_assignee
    ON jira_tickets(assignee)
  `;
});
