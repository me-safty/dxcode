import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Adds a full-text search index over message bodies so search can match chat
 * *content*, not just titles. An FTS5 virtual table mirrors
 * `projection_thread_messages.text`, linked by rowid for O(1) trigger upkeep.
 *
 * Purely additive: no existing table or row is altered. Existing finalized
 * messages are backfilled, so old conversations stay in the DB *and* become
 * searchable. Triggers keep it in sync but only index finalized messages
 * (`is_streaming = 0`) — a streaming reply upserts the same row token-by-token,
 * and indexing every step would churn the index, so we wait until it finalizes.
 * User messages and finalized assistant messages both land at `is_streaming = 0`,
 * so both roles are indexed.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS projection_thread_messages_fts USING fts5(
      text,
      message_id UNINDEXED,
      thread_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;

  // Backfill finalized messages that predate this migration (reads only).
  yield* sql`
    INSERT INTO projection_thread_messages_fts (rowid, text, message_id, thread_id)
    SELECT rowid, text, message_id, thread_id
    FROM projection_thread_messages
    WHERE is_streaming = 0
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_ai
    AFTER INSERT ON projection_thread_messages
    WHEN new.is_streaming = 0
    BEGIN
      INSERT INTO projection_thread_messages_fts (rowid, text, message_id, thread_id)
      VALUES (new.rowid, new.text, new.message_id, new.thread_id);
    END
  `;

  // Covers both the streaming -> finalized transition and later edits to a
  // finalized message. Delete-then-insert re-indexes; the delete is a no-op when
  // the row was still streaming (never indexed).
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_au
    AFTER UPDATE ON projection_thread_messages
    WHEN new.is_streaming = 0
    BEGIN
      DELETE FROM projection_thread_messages_fts WHERE rowid = new.rowid;
      INSERT INTO projection_thread_messages_fts (rowid, text, message_id, thread_id)
      VALUES (new.rowid, new.text, new.message_id, new.thread_id);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_ad
    AFTER DELETE ON projection_thread_messages
    BEGIN
      DELETE FROM projection_thread_messages_fts WHERE rowid = old.rowid;
    END
  `;
});
