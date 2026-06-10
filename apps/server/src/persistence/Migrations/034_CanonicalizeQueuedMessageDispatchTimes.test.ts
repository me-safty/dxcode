import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0034 from "./034_CanonicalizeQueuedMessageDispatchTimes.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_CanonicalizeQueuedMessageDispatchTimes", (it) => {
  it.effect("repairs only queued-dispatch user message timestamps and is idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-repair',
          'Queued repair project',
          '/tmp/queued-repair',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-05-01T00:00:00.000Z',
          '2026-05-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES (
          'thread-repair',
          'project-repair',
          'Queued repair thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          NULL,
          '2026-05-01T00:00:00.000Z',
          '2026-05-01T00:04:00.000Z',
          NULL,
          '2026-05-01T00:04:00.000Z',
          0,
          0,
          0,
          NULL,
          'full-access',
          'default'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES
          (
            'message-queued',
            'thread-repair',
            NULL,
            'user',
            'queued user message',
            '[]',
            0,
            '2026-05-01T00:01:00.000Z',
            '2026-05-01T00:05:00.000Z'
          ),
          (
            'message-ordinary',
            'thread-repair',
            NULL,
            'user',
            'ordinary user message',
            '[]',
            0,
            '2026-05-01T00:04:00.000Z',
            '2026-05-01T00:04:00.000Z'
          ),
          (
            'message-assistant',
            'thread-repair',
            'turn-assistant',
            'assistant',
            'assistant output',
            '[]',
            0,
            '2026-05-01T00:07:00.000Z',
            '2026-05-01T00:07:00.000Z'
          ),
          (
            'message-mismatch',
            'thread-repair',
            NULL,
            'user',
            'mismatched user message',
            '[]',
            0,
            '2026-05-01T00:03:00.000Z',
            '2026-05-01T00:09:00.000Z'
          )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'event-dispatch-queued',
            'thread',
            'thread-repair',
            1,
            'thread.queued-turn-dispatched',
            '2026-05-01T00:05:00.000Z',
            'cmd-dispatch-queued',
            NULL,
            'corr-dispatch-queued',
            'system',
            '{"threadId":"thread-repair","messageId":"message-queued","dispatchedAt":"2026-05-01T00:05:00.000Z"}',
            '{}'
          ),
          (
            'event-message-queued',
            'thread',
            'thread-repair',
            2,
            'thread.message-sent',
            '2026-05-01T00:05:00.000Z',
            'cmd-dispatch-queued',
            'event-dispatch-queued',
            'corr-dispatch-queued',
            'system',
            '{"threadId":"thread-repair","messageId":"message-queued","role":"user","text":"queued user message","attachments":[],"turnId":null,"streaming":false,"createdAt":"2026-05-01T00:01:00.000Z","updatedAt":"2026-05-01T00:05:00.000Z"}',
            '{}'
          ),
          (
            'event-message-ordinary',
            'thread',
            'thread-repair',
            3,
            'thread.message-sent',
            '2026-05-01T00:04:00.000Z',
            'cmd-message-ordinary',
            NULL,
            'corr-message-ordinary',
            'user',
            '{"threadId":"thread-repair","messageId":"message-ordinary","role":"user","text":"ordinary user message","attachments":[],"turnId":null,"streaming":false,"createdAt":"2026-05-01T00:04:00.000Z","updatedAt":"2026-05-01T00:04:00.000Z"}',
            '{}'
          ),
          (
            'event-message-assistant',
            'thread',
            'thread-repair',
            4,
            'thread.message-sent',
            '2026-05-01T00:07:00.000Z',
            'cmd-message-assistant',
            'event-dispatch-queued',
            'corr-message-assistant',
            'system',
            '{"threadId":"thread-repair","messageId":"message-assistant","role":"assistant","text":"assistant output","attachments":[],"turnId":"turn-assistant","streaming":false,"createdAt":"2026-05-01T00:07:00.000Z","updatedAt":"2026-05-01T00:07:00.000Z"}',
            '{}'
          ),
          (
            'event-dispatch-mismatch',
            'thread',
            'thread-repair',
            5,
            'thread.queued-turn-dispatched',
            '2026-05-01T00:09:00.000Z',
            'cmd-dispatch-mismatch',
            NULL,
            'corr-dispatch-mismatch',
            'system',
            '{"threadId":"thread-repair","messageId":"different-message","dispatchedAt":"2026-05-01T00:09:00.000Z"}',
            '{}'
          ),
          (
            'event-message-mismatch',
            'thread',
            'thread-repair',
            6,
            'thread.message-sent',
            '2026-05-01T00:09:00.000Z',
            'cmd-dispatch-mismatch',
            'event-dispatch-mismatch',
            'corr-dispatch-mismatch',
            'system',
            '{"threadId":"thread-repair","messageId":"message-mismatch","role":"user","text":"mismatched user message","attachments":[],"turnId":null,"streaming":false,"createdAt":"2026-05-01T00:03:00.000Z","updatedAt":"2026-05-01T00:09:00.000Z"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 34 });

      const messages = yield* sql<{
        readonly messageId: string;
        readonly createdAt: string;
      }>`
        SELECT
          message_id AS "messageId",
          created_at AS "createdAt"
        FROM projection_thread_messages
        ORDER BY message_id ASC
      `;
      assert.deepStrictEqual(messages, [
        {
          messageId: "message-assistant",
          createdAt: "2026-05-01T00:07:00.000Z",
        },
        {
          messageId: "message-mismatch",
          createdAt: "2026-05-01T00:03:00.000Z",
        },
        {
          messageId: "message-ordinary",
          createdAt: "2026-05-01T00:04:00.000Z",
        },
        {
          messageId: "message-queued",
          createdAt: "2026-05-01T00:05:00.000Z",
        },
      ]);

      const messageEvents = yield* sql<{
        readonly eventId: string;
        readonly createdAt: string;
      }>`
        SELECT
          event_id AS "eventId",
          json_extract(payload_json, '$.createdAt') AS "createdAt"
        FROM orchestration_events
        WHERE event_type = 'thread.message-sent'
        ORDER BY event_id ASC
      `;
      assert.deepStrictEqual(messageEvents, [
        {
          eventId: "event-message-assistant",
          createdAt: "2026-05-01T00:07:00.000Z",
        },
        {
          eventId: "event-message-mismatch",
          createdAt: "2026-05-01T00:03:00.000Z",
        },
        {
          eventId: "event-message-ordinary",
          createdAt: "2026-05-01T00:04:00.000Z",
        },
        {
          eventId: "event-message-queued",
          createdAt: "2026-05-01T00:05:00.000Z",
        },
      ]);

      const threadRows = yield* sql<{
        readonly latestUserMessageAt: string | null;
      }>`
        SELECT latest_user_message_at AS "latestUserMessageAt"
        FROM projection_threads
        WHERE thread_id = 'thread-repair'
      `;
      assert.deepStrictEqual(threadRows, [
        {
          latestUserMessageAt: "2026-05-01T00:05:00.000Z",
        },
      ]);

      const snapshotAfterFirstRun = yield* sql<{
        readonly messageId: string;
        readonly createdAt: string;
      }>`
        SELECT
          message_id AS "messageId",
          created_at AS "createdAt"
        FROM projection_thread_messages
        ORDER BY message_id ASC
      `;

      yield* Migration0034;

      const snapshotAfterSecondRun = yield* sql<{
        readonly messageId: string;
        readonly createdAt: string;
      }>`
        SELECT
          message_id AS "messageId",
          created_at AS "createdAt"
        FROM projection_thread_messages
        ORDER BY message_id ASC
      `;
      assert.deepStrictEqual(snapshotAfterSecondRun, snapshotAfterFirstRun);
    }),
  );
});
