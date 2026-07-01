import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'workspace'
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE projection_projects
    SET kind = 'workspace'
    WHERE kind IS NULL OR kind = ''
  `;
});
