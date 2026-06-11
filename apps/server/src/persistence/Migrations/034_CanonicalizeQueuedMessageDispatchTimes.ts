import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DROP TABLE IF EXISTS queued_message_dispatch_time_repair_candidates
  `;

  yield* sql`
    CREATE TEMP TABLE queued_message_dispatch_time_repair_candidates AS
    SELECT
      message_event.event_id AS message_event_id,
      json_extract(message_event.payload_json, '$.threadId') AS thread_id,
      json_extract(message_event.payload_json, '$.messageId') AS message_id,
      json_extract(dispatch_event.payload_json, '$.dispatchedAt') AS dispatched_at
    FROM orchestration_events AS message_event
    INNER JOIN orchestration_events AS dispatch_event
      ON dispatch_event.event_id = message_event.causation_event_id
     AND dispatch_event.event_type = 'thread.queued-turn-dispatched'
    WHERE message_event.event_type = 'thread.message-sent'
      AND json_extract(message_event.payload_json, '$.role') = 'user'
      AND json_extract(message_event.payload_json, '$.threadId') = message_event.stream_id
      AND json_extract(dispatch_event.payload_json, '$.threadId') =
        json_extract(message_event.payload_json, '$.threadId')
      AND json_extract(dispatch_event.payload_json, '$.messageId') =
        json_extract(message_event.payload_json, '$.messageId')
      AND json_extract(message_event.payload_json, '$.createdAt') IS NOT NULL
      AND json_extract(message_event.payload_json, '$.updatedAt') IS NOT NULL
      AND json_extract(dispatch_event.payload_json, '$.dispatchedAt') IS NOT NULL
      AND json_extract(message_event.payload_json, '$.createdAt') !=
        json_extract(message_event.payload_json, '$.updatedAt')
  `;

  yield* sql`
    UPDATE projection_thread_messages
    SET created_at = (
      SELECT candidate.dispatched_at
      FROM queued_message_dispatch_time_repair_candidates AS candidate
      WHERE candidate.thread_id = projection_thread_messages.thread_id
        AND candidate.message_id = projection_thread_messages.message_id
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1
      FROM queued_message_dispatch_time_repair_candidates AS candidate
      WHERE candidate.thread_id = projection_thread_messages.thread_id
        AND candidate.message_id = projection_thread_messages.message_id
        AND candidate.dispatched_at != projection_thread_messages.created_at
    )
  `;

  yield* sql`
    UPDATE projection_threads
    SET latest_user_message_at = (
      SELECT MAX(message.created_at)
      FROM projection_thread_messages AS message
      WHERE message.thread_id = projection_threads.thread_id
        AND message.role = 'user'
    )
    WHERE thread_id IN (
      SELECT thread_id
      FROM queued_message_dispatch_time_repair_candidates
    )
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.createdAt',
      (
        SELECT candidate.dispatched_at
        FROM queued_message_dispatch_time_repair_candidates AS candidate
        WHERE candidate.message_event_id = orchestration_events.event_id
        LIMIT 1
      )
    )
    WHERE event_id IN (
      SELECT message_event_id
      FROM queued_message_dispatch_time_repair_candidates
    )
  `;

  yield* sql`
    DROP TABLE IF EXISTS queued_message_dispatch_time_repair_candidates
  `;
});
