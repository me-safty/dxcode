import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_remove(
      payload_json,
      '$.data.result',
      '$.data.item.result'
    )
    WHERE kind IN ('tool.completed', 'tool.updated')
      AND json_extract(payload_json, '$.itemType') = 'image_view'
      AND (
        json_type(payload_json, '$.data.result') IS NOT NULL
        OR json_type(payload_json, '$.data.item.result') IS NOT NULL
      )
  `;
});
