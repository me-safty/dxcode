import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("017_RenameClaudeCodeProvider", (it) => {
  it.effect(
    "migrates claudeCode provider references to claudeAgent across all tables",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Run all migrations up to 016
        {
          yield* runMigrations({ toMigrationInclusive: 16 });

          // Insert provider_session_runtime rows with claudeCode
          yield* sql`
            INSERT INTO provider_session_runtime (
              thread_id, provider_name, adapter_key, runtime_mode, status, last_seen_at, resume_cursor_json, runtime_payload_json
            )
            VALUES
              ('thread-claude-code', 'claudeCode', 'claudeCode', 'full-access', 'running', '2026-01-01T00:00:00.000Z', NULL, NULL),
              ('thread-codex', 'codex', 'codex', 'full-access', 'running', '2026-01-01T00:00:00.000Z', NULL, NULL)
          `;

          // Insert projection_thread_sessions with claudeCode
          yield* sql`
            INSERT INTO projection_thread_sessions (
              thread_id, status, provider_name, provider_session_id, provider_thread_id, active_turn_id, last_error, updated_at, runtime_mode
            )
            VALUES
              ('thread-claude-code', 'running', 'claudeCode', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', 'full-access'),
              ('thread-codex', 'running', 'codex', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', 'full-access')
          `;

          // Insert projection_threads with claudeCode in model_selection_json
          yield* sql`
            INSERT INTO projection_threads (
              thread_id, project_id, title, model_selection_json, branch, worktree_path, latest_turn_id, created_at, updated_at, deleted_at, runtime_mode, interaction_mode
            )
            VALUES
              ('thread-claude-code', 'project-1', 'Claude Code thread', '{"provider":"claudeCode","model":"claude-opus-4-6"}', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
              ('thread-codex', 'project-1', 'Codex thread', '{"provider":"codex","model":"gpt-5.4"}', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default')
          `;

          // Insert projection_projects with claudeCode in default_model_selection_json
          yield* sql`
            INSERT INTO projection_projects (
              project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
            )
            VALUES
              ('project-claude-code', 'Claude Code project', '/tmp/project-claude-code', '{"provider":"claudeCode","model":"claude-opus-4-6"}', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
              ('project-codex', 'Codex project', '/tmp/project-codex', '{"provider":"codex","model":"gpt-5.4"}', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)
          `;

          // Insert orchestration_events with claudeCode in modelSelection and defaultModelSelection
          yield* sql`
            INSERT INTO orchestration_events (
              event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
            )
            VALUES
            (
              'event-thread-claude-code',
              'thread',
              'thread-claude-code',
              1,
              'thread.created',
              '2026-01-01T00:00:00.000Z',
              'command-1',
              NULL,
              'correlation-1',
              'user',
              '{"threadId":"thread-claude-code","projectId":"project-1","title":"Thread","modelSelection":{"provider":"claudeCode","model":"claude-opus-4-6"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
              '{}'
            ),
            (
              'event-thread-codex',
              'thread',
              'thread-codex',
              1,
              'thread.created',
              '2026-01-01T00:00:00.000Z',
              'command-2',
              NULL,
              'correlation-2',
              'user',
              '{"threadId":"thread-codex","projectId":"project-1","title":"Codex Thread","modelSelection":{"provider":"codex","model":"gpt-5.4"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
              '{}'
            ),
            (
              'event-project-claude-code',
              'project',
              'project-claude-code',
              1,
              'project.created',
              '2026-01-01T00:00:00.000Z',
              'command-3',
              NULL,
              'correlation-3',
              'user',
              '{"projectId":"project-claude-code","title":"Project","workspaceRoot":"/tmp/project","defaultModelSelection":{"provider":"claudeCode","model":"claude-opus-4-6"},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
              '{}'
            )
          `;
        }

        // Execute migration under test
        yield* runMigrations({ toMigrationInclusive: 17 });

        // Assert provider_session_runtime
        {
          const runtimeRows = yield* sql<{
            readonly threadId: string;
            readonly providerName: string;
            readonly adapterKey: string;
          }>`
            SELECT
              thread_id AS "threadId",
              provider_name AS "providerName",
              adapter_key AS "adapterKey"
            FROM provider_session_runtime
            ORDER BY thread_id
          `;
          assert.deepStrictEqual(runtimeRows, [
            { threadId: "thread-claude-code", providerName: "claudeAgent", adapterKey: "claudeAgent" },
            { threadId: "thread-codex", providerName: "codex", adapterKey: "codex" },
          ]);
        }

        // Assert projection_thread_sessions
        {
          const sessionRows = yield* sql<{
            readonly threadId: string;
            readonly providerName: string | null;
          }>`
            SELECT
              thread_id AS "threadId",
              provider_name AS "providerName"
            FROM projection_thread_sessions
            ORDER BY thread_id
          `;
          assert.deepStrictEqual(sessionRows, [
            { threadId: "thread-claude-code", providerName: "claudeAgent" },
            { threadId: "thread-codex", providerName: "codex" },
          ]);
        }

        // Assert projection_threads
        {
          const threadRows = yield* sql<{
            readonly threadId: string;
            readonly modelSelection: string;
          }>`
            SELECT
              thread_id AS "threadId",
              model_selection_json AS "modelSelection"
            FROM projection_threads
            ORDER BY thread_id
          `;
          assert.deepStrictEqual(threadRows, [
            { threadId: "thread-claude-code", modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}' },
            { threadId: "thread-codex", modelSelection: '{"provider":"codex","model":"gpt-5.4"}' },
          ]);
        }

        // Assert projection_projects
        {
          const projectRows = yield* sql<{
            readonly projectId: string;
            readonly defaultModelSelection: string | null;
          }>`
            SELECT
              project_id AS "projectId",
              default_model_selection_json AS "defaultModelSelection"
            FROM projection_projects
            ORDER BY project_id
          `;
          assert.deepStrictEqual(projectRows, [
            { projectId: "project-claude-code", defaultModelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}' },
            { projectId: "project-codex", defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}' },
          ]);
        }

        // Assert orchestration_events
        {
          const eventRows = yield* sql<{
            readonly eventId: string;
            readonly payloadJson: string;
          }>`
            SELECT
              event_id AS "eventId",
              payload_json AS "payloadJson"
            FROM orchestration_events
            ORDER BY rowid ASC
          `;

          const threadEvent = JSON.parse(eventRows[0]!.payloadJson);
          assert.equal(threadEvent.modelSelection.provider, "claudeAgent");

          const codexEvent = JSON.parse(eventRows[1]!.payloadJson);
          assert.equal(codexEvent.modelSelection.provider, "codex");

          const projectEvent = JSON.parse(eventRows[2]!.payloadJson);
          assert.equal(projectEvent.defaultModelSelection.provider, "claudeAgent");
        }
      }),
  );
});
