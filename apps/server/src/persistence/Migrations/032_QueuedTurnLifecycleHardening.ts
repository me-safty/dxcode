import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN queue_item_id TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE projection_queued_turns
    SET
      status = 'sending',
      failure_reason = NULL
    WHERE status = 'accepted'
  `;
});
