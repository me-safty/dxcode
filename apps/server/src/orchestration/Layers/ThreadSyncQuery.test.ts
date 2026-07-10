import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ThreadId } from "@t3tools/contracts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ThreadSyncQuery } from "../Services/ThreadSyncQuery.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { ThreadSyncQueryLive } from "./ThreadSyncQuery.ts";

const layer = it.layer(ThreadSyncQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("ThreadSyncQuery", (it) => {
  it.effect("returns a bounded tail and keyset pages invalidated only by revert epoch", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = yield* ThreadSyncQuery;
      const threadId = ThreadId.make("thread-sync-query");
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        ) VALUES (
          ${threadId}, 'project-1', 'Thread', '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access', 'default', 'main', NULL, NULL, '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
        )
      `;
      for (const projector of [
        ORCHESTRATION_PROJECTOR_NAMES.threads,
        ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
        ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
        ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
        ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
        ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
        ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
      ]) {
        yield* sql`INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
          VALUES (${projector}, 77, '2026-01-01T00:00:00.000Z')`;
      }
      for (let index = 0; index < 40; index += 1) {
        const at = `2026-01-01T00:${Math.floor(index / 60)
          .toString()
          .padStart(2, "0")}:${(index % 60).toString().padStart(2, "0")}.000Z`;
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, attachments_json,
            is_streaming, created_at, updated_at
          ) VALUES (${`message-${index.toString().padStart(3, "0")}`}, ${threadId}, NULL,
            'user', ${`message ${index}`}, NULL, 0, ${at}, ${at})
        `;
      }
      for (let index = 0; index < 140; index += 1) {
        const at = `2026-01-02T00:${Math.floor(index / 60)
          .toString()
          .padStart(2, "0")}:${(index % 60).toString().padStart(2, "0")}.000Z`;
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
          ) VALUES (${`activity-${index.toString().padStart(3, "0")}`}, ${threadId}, NULL,
            'info', 'task.progress', ${`activity ${index}`}, '{}', ${index + 1}, ${at})
        `;
      }

      const tailOption = yield* query.getTail(threadId);
      const tail = Option.getOrThrow(tailOption);
      assert.strictEqual(tail.messages.length, 32);
      assert.strictEqual(tail.activities.length, 128);
      assert.strictEqual(tail.messages[0]?.id, "message-008");
      assert.strictEqual(tail.watermark, 77);

      const firstPage = yield* query.getHistoryPage({
        threadId,
        historyEpoch: tail.historyEpoch,
        before: tail.before,
        messageLimit: 32,
        activityLimit: 128,
      });
      if (firstPage.page === null) return yield* Effect.die("Expected a history page.");
      assert.strictEqual(firstPage.page.messages.length, 8);
      assert.strictEqual(firstPage.page.activities.length, 12);
      assert.strictEqual(firstPage.page.hasOlderMessages, false);

      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        ) VALUES ('revert-event', 'thread', ${threadId}, 1, 'thread.reverted',
          '2026-01-03T00:00:00.000Z', NULL, NULL, NULL, 'system', '{}', '{}')
      `;
      const invalidated = yield* query.getHistoryPage({
        threadId,
        historyEpoch: tail.historyEpoch,
        before: tail.before,
        messageLimit: 32,
        activityLimit: 128,
      });
      assert.strictEqual(invalidated.page, null);
      assert(invalidated.currentHistoryEpoch > tail.historyEpoch);
    }),
  );
});
