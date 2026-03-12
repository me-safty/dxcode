import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS rlhf_message_feedback_next (
      message_id TEXT PRIMARY KEY,
      rating TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO rlhf_message_feedback_next (
      message_id,
      rating,
      note,
      created_at,
      updated_at
    )
    SELECT
      message_id,
      rating,
      note,
      created_at,
      updated_at
    FROM rlhf_message_feedback
  `;

  yield* sql`DROP TABLE rlhf_message_feedback`;

  yield* sql`
    ALTER TABLE rlhf_message_feedback_next
    RENAME TO rlhf_message_feedback
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_rlhf_message_feedback_rating
    ON rlhf_message_feedback(rating)
  `;
});
