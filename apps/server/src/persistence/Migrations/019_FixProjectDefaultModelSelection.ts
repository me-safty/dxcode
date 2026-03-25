import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Migration 016 left some project events without defaultModelSelection.
// Finish that backfill for both null and non-null defaultModel payloads.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(payload_json, '$.defaultModelSelection', json('null')),
      '$.defaultProvider',
      '$.defaultModel',
      '$.defaultModelOptions'
    )
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_type(payload_json, '$.defaultModelSelection') IS NULL
      AND json_type(payload_json, '$.defaultModel') = 'null'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.defaultModelSelection',
        json_patch(
          json_object(
            'provider',
            CASE
              WHEN json_extract(payload_json, '$.defaultProvider') IS NOT NULL
              THEN json_extract(payload_json, '$.defaultProvider')
              WHEN lower(json_extract(payload_json, '$.defaultModel')) LIKE '%claude%'
              THEN 'claudeAgent'
              ELSE 'codex'
            END,
            'model',
            json_extract(payload_json, '$.defaultModel')
          ),
          '{}'
        )
      ),
      '$.defaultProvider',
      '$.defaultModel',
      '$.defaultModelOptions'
    )
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_type(payload_json, '$.defaultModelSelection') IS NULL
      AND json_type(payload_json, '$.defaultModel') IS NOT NULL
      AND json_type(payload_json, '$.defaultModel') != 'null'
  `;
});
