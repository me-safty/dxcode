import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_StripImageViewActivityResults", (it) => {
  it.effect("removes inline image bytes from image view activity payloads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-image-view',
            'thread-1',
            'turn-1',
            'tool',
            'tool.completed',
            'Image view',
            '{"itemType":"image_view","data":{"result":"top-level-bytes","completedAtMs":123,"item":{"id":"ig-1","prompt":"paint a cat","result":"nested-bytes"}}}',
            NULL,
            '2026-04-13T00:01:00.000Z'
          ),
          (
            'activity-dynamic-tool',
            'thread-1',
            'turn-1',
            'tool',
            'tool.completed',
            'Dynamic tool',
            '{"itemType":"dynamic_tool_call","data":{"result":"keep-me","item":{"id":"tool-1","result":"keep-me-too"}}}',
            NULL,
            '2026-04-13T00:02:00.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 33 });

      const rows = yield* sql<{
        readonly activityId: string;
        readonly itemType: string;
        readonly topLevelResult: string | null;
        readonly nestedResult: string | null;
        readonly nestedId: string | null;
        readonly completedAtMs: number | null;
      }>`
        SELECT
          activity_id AS "activityId",
          json_extract(payload_json, '$.itemType') AS "itemType",
          json_extract(payload_json, '$.data.result') AS "topLevelResult",
          json_extract(payload_json, '$.data.item.result') AS "nestedResult",
          json_extract(payload_json, '$.data.item.id') AS "nestedId",
          json_extract(payload_json, '$.data.completedAtMs') AS "completedAtMs"
        FROM projection_thread_activities
        ORDER BY activity_id ASC
      `;

      assert.deepStrictEqual(rows, [
        {
          activityId: "activity-dynamic-tool",
          itemType: "dynamic_tool_call",
          topLevelResult: "keep-me",
          nestedResult: "keep-me-too",
          nestedId: "tool-1",
          completedAtMs: null,
        },
        {
          activityId: "activity-image-view",
          itemType: "image_view",
          topLevelResult: null,
          nestedResult: null,
          nestedId: "ig-1",
          completedAtMs: 123,
        },
      ]);
    }),
  );
});
