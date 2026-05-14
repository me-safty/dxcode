import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { CanonicalModelSelection, TurnQueueItemId } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionQueuedTurnsInput,
  ListProjectionQueuedTurnsInput,
  ProjectionQueuedTurn,
  ProjectionQueuedTurnRepository,
  type ProjectionQueuedTurnRepositoryShape,
} from "../Services/ProjectionQueuedTurns.ts";

const ProjectionQueuedTurnRow = ProjectionQueuedTurn.mapFields(
  Struct.assign({
    modelSelection: Schema.NullOr(Schema.fromJsonString(CanonicalModelSelection)),
  }),
);
const encodeModelSelectionJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(CanonicalModelSelection),
);
const GetProjectionQueuedTurnInput = Schema.Struct({
  queueItemId: TurnQueueItemId,
});

const makeProjectionQueuedTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionQueuedTurnRow = SqlSchema.void({
    Request: ProjectionQueuedTurn,
    execute: (row) =>
      sql`
        INSERT INTO projection_queued_turns (
          queue_item_id,
          thread_id,
          message_id,
          model_selection_json,
          title_seed,
          runtime_mode,
          interaction_mode,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          status,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          ${row.queueItemId},
          ${row.threadId},
          ${row.messageId},
          ${row.modelSelection === null ? null : encodeModelSelectionJson(row.modelSelection)},
          ${row.titleSeed},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.status},
          ${row.failureReason},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (queue_item_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          message_id = excluded.message_id,
          model_selection_json = excluded.model_selection_json,
          title_seed = excluded.title_seed,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          status = excluded.status,
          failure_reason = excluded.failure_reason,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionQueuedTurnRow = SqlSchema.findOneOption({
    Request: GetProjectionQueuedTurnInput,
    Result: ProjectionQueuedTurnRow,
    execute: ({ queueItemId }) =>
      sql`
        SELECT
          queue_item_id AS "queueItemId",
          thread_id AS "threadId",
          message_id AS "messageId",
          model_selection_json AS "modelSelection",
          title_seed AS "titleSeed",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          status,
          failure_reason AS "failureReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_queued_turns
        WHERE queue_item_id = ${queueItemId}
      `,
  });

  const listProjectionQueuedTurnRows = SqlSchema.findAll({
    Request: ListProjectionQueuedTurnsInput,
    Result: ProjectionQueuedTurnRow,
    execute: (input) =>
      input.threadId === undefined
        ? sql`
            SELECT
              queue_item_id AS "queueItemId",
              thread_id AS "threadId",
              message_id AS "messageId",
              model_selection_json AS "modelSelection",
              title_seed AS "titleSeed",
              runtime_mode AS "runtimeMode",
              interaction_mode AS "interactionMode",
              source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
              source_proposed_plan_id AS "sourceProposedPlanId",
              status,
              failure_reason AS "failureReason",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM projection_queued_turns
            ORDER BY created_at ASC, queue_item_id ASC
          `
        : sql`
            SELECT
              queue_item_id AS "queueItemId",
              thread_id AS "threadId",
              message_id AS "messageId",
              model_selection_json AS "modelSelection",
              title_seed AS "titleSeed",
              runtime_mode AS "runtimeMode",
              interaction_mode AS "interactionMode",
              source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
              source_proposed_plan_id AS "sourceProposedPlanId",
              status,
              failure_reason AS "failureReason",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM projection_queued_turns
            WHERE thread_id = ${input.threadId}
            ORDER BY created_at ASC, queue_item_id ASC
          `,
  });

  const deleteProjectionQueuedTurnRows = SqlSchema.void({
    Request: DeleteProjectionQueuedTurnsInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_queued_turns
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionQueuedTurnRepositoryShape["upsert"] = (row) =>
    upsertProjectionQueuedTurnRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionQueuedTurnRepository.upsert:query")),
    );

  const getByQueueItemId: ProjectionQueuedTurnRepositoryShape["getByQueueItemId"] = (input) =>
    getProjectionQueuedTurnRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionQueuedTurnRepository.getByQueueItemId:query"),
      ),
    );

  const list: ProjectionQueuedTurnRepositoryShape["list"] = (input = {}) =>
    listProjectionQueuedTurnRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionQueuedTurnRepository.list:query")),
    );

  const deleteByThreadId: ProjectionQueuedTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionQueuedTurnRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionQueuedTurnRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByQueueItemId,
    list,
    deleteByThreadId,
  } satisfies ProjectionQueuedTurnRepositoryShape;
});

export const ProjectionQueuedTurnRepositoryLive = Layer.effect(
  ProjectionQueuedTurnRepository,
  makeProjectionQueuedTurnRepository,
);
