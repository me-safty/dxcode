import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      expiration_time INTEGER,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_successful_push_at TEXT,
      last_failed_push_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      disabled_at TEXT,
      FOREIGN KEY(session_id) REFERENCES auth_sessions(session_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_active
    ON web_push_subscriptions(disabled_at, session_id, updated_at)
  `;
});
