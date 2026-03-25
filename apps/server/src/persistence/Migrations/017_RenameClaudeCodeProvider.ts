import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Rename 'claudeCode' → 'claudeAgent' in provider_session_runtime
  yield* sql`
    UPDATE provider_session_runtime
    SET provider_name = 'claudeAgent',
        adapter_key = CASE
          WHEN adapter_key = 'claudeCode' THEN 'claudeAgent'
          ELSE adapter_key
        END
    WHERE provider_name = 'claudeCode'
  `;

  // Rename in projection_thread_sessions
  yield* sql`
    UPDATE projection_thread_sessions
    SET provider_name = 'claudeAgent'
    WHERE provider_name = 'claudeCode'
  `;

  // Rename in projection_threads.model_selection_json
  yield* sql`
    UPDATE projection_threads
    SET model_selection_json = json_set(model_selection_json, '$.provider', 'claudeAgent')
    WHERE json_extract(model_selection_json, '$.provider') = 'claudeCode'
  `;

  // Rename in projection_projects.default_model_selection_json
  yield* sql`
    UPDATE projection_projects
    SET default_model_selection_json = json_set(default_model_selection_json, '$.provider', 'claudeAgent')
    WHERE json_extract(default_model_selection_json, '$.provider') = 'claudeCode'
  `;

  // Rename in orchestration_events payload modelSelection.provider
  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.modelSelection.provider', 'claudeAgent')
    WHERE json_extract(payload_json, '$.modelSelection.provider') = 'claudeCode'
  `;

  // Also handle defaultModelSelection in project events
  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.defaultModelSelection.provider', 'claudeAgent')
    WHERE json_extract(payload_json, '$.defaultModelSelection.provider') = 'claudeCode'
  `;
});
