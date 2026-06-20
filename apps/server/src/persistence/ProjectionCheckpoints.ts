import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import {
  type ProjectionRepositoryError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "./Errors.ts";

/**
 * ProjectionCheckpointRepository - Projection repository interface for checkpoints.
 *
 * Owns persistence operations for projected checkpoint summaries in thread
 * timelines.
 *
 * @module ProjectionCheckpointRepository
 */

export const ProjectionCheckpoint = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpoint = typeof ProjectionCheckpoint.Type;

export const ListByThreadIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListByThreadIdInput = typeof ListByThreadIdInput.Type;

export const GetByThreadAndTurnCountInput = Schema.Struct({
  threadId: ThreadId,
  checkpointTurnCount: NonNegativeInt,
});
export type GetByThreadAndTurnCountInput = typeof GetByThreadAndTurnCountInput.Type;

export const DeleteByThreadIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteByThreadIdInput = typeof DeleteByThreadIdInput.Type;

/**
 * ProjectionCheckpointRepository - Service tag for checkpoint projection persistence.
 */
export class ProjectionCheckpointRepository extends Context.Service<
  ProjectionCheckpointRepository,
  {
    /**
     * Insert or replace a projected checkpoint row.
     *
     * Upserts by composite key `(threadId, checkpointTurnCount)`.
     */
    readonly upsert: (row: ProjectionCheckpoint) => Effect.Effect<void, ProjectionRepositoryError>;

    /**
     * List projected checkpoints for a thread.
     *
     * Returned in ascending checkpoint turn-count order.
     */
    readonly listByThreadId: (
      input: ListByThreadIdInput,
    ) => Effect.Effect<ReadonlyArray<ProjectionCheckpoint>, ProjectionRepositoryError>;

    /**
     * Read a projected checkpoint by thread and turn-count key.
     */
    readonly getByThreadAndTurnCount: (
      input: GetByThreadAndTurnCountInput,
    ) => Effect.Effect<Option.Option<ProjectionCheckpoint>, ProjectionRepositoryError>;

    /**
     * Delete projected checkpoint rows by thread.
     */
    readonly deleteByThreadId: (
      input: DeleteByThreadIdInput,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
  }
>()("t3/persistence/ProjectionCheckpoints/ProjectionCheckpointRepository") {}

const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const clearCheckpointConflict = SqlSchema.void({
    Request: GetByThreadAndTurnCountInput,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  });

  const upsertProjectionCheckpointRow = SqlSchema.void({
    Request: ProjectionCheckpointDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          NULL,
          ${row.assistantMessageId},
          ${row.status === "error" ? "error" : "completed"},
          ${row.completedAt},
          ${row.completedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.status},
          ${row.files}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `,
  });

  const listProjectionCheckpointRows = SqlSchema.findAll({
    Request: ListByThreadIdInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getProjectionCheckpointRow = SqlSchema.findOneOption({
    Request: GetByThreadAndTurnCountInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  });

  const deleteProjectionCheckpointRows = SqlSchema.void({
    Request: DeleteByThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
      `,
  });

  const upsertCheckpointRow = (row: Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>) =>
    sql.withTransaction(
      clearCheckpointConflict({
        threadId: row.threadId,
        checkpointTurnCount: row.checkpointTurnCount,
      }).pipe(Effect.flatMap(() => upsertProjectionCheckpointRow(row))),
    );

  const upsert: ProjectionCheckpointRepository["Service"]["upsert"] = (row) =>
    upsertCheckpointRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.upsert:query",
          "ProjectionCheckpointRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ProjectionCheckpointRepository["Service"]["listByThreadId"] = (input) =>
    listProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.listByThreadId:query",
          "ProjectionCheckpointRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionCheckpoint>>),
    );

  const getByThreadAndTurnCount: ProjectionCheckpointRepository["Service"]["getByThreadAndTurnCount"] =
    (input) =>
      getProjectionCheckpointRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionCheckpointRepository.getByThreadAndTurnCount:query",
            "ProjectionCheckpointRepository.getByThreadAndTurnCount:decodeRow",
          ),
        ),
        Effect.flatMap((rowOption) =>
          Option.match(rowOption, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: (row) =>
              Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionCheckpoint>)),
          }),
        ),
      );

  const deleteByThreadId: ProjectionCheckpointRepository["Service"]["deleteByThreadId"] = (input) =>
    deleteProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionCheckpointRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    getByThreadAndTurnCount,
    deleteByThreadId,
  } satisfies ProjectionCheckpointRepository["Service"];
});

export const layer = Layer.effect(ProjectionCheckpointRepository, make);
