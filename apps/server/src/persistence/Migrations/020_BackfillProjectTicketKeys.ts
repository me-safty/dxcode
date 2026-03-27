import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Backfill ticket_key and jira_url for projects created before the Jira import
  // feature. These projects have the ticket key embedded in their title
  // (e.g., "CE-15113: Igus and PepsiCo shutdown") but ticket_key is NULL.
  yield* sql`
    UPDATE projection_projects
    SET ticket_key = SUBSTR(title, 1, INSTR(title, ':') - 1),
        jira_url = 'https://mediafly.atlassian.net/browse/' || SUBSTR(title, 1, INSTR(title, ':') - 1)
    WHERE ticket_key IS NULL
      AND deleted_at IS NULL
      AND title GLOB '[A-Z]*-[0-9]*:*'
  `;
});
