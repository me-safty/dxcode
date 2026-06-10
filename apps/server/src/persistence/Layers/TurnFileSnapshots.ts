import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteTurnFileSnapshotsByThreadInput,
  DeleteTurnFileSnapshotsByTurnInput,
  GetTurnFileSnapshotsByTurnInput,
  TurnFileSnapshot,
  TurnFileSnapshots,
  UpsertTurnFileSnapshotInput,
  type TurnFileSnapshotsShape,
} from "../Services/TurnFileSnapshots.ts";

const TurnFileSnapshotDbRow = Schema.Struct({
  threadId: TurnFileSnapshot.fields.threadId,
  turnId: TurnFileSnapshot.fields.turnId,
  path: TurnFileSnapshot.fields.path,
  blobSha: TurnFileSnapshot.fields.blobSha,
  deleted: Schema.Number,
  updatedAt: TurnFileSnapshot.fields.updatedAt,
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function mapSnapshotRow(row: Schema.Schema.Type<typeof TurnFileSnapshotDbRow>) {
  return {
    ...row,
    deleted: row.deleted !== 0,
  };
}

const makeTurnFileSnapshots = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertSnapshotRow = SqlSchema.void({
    Request: UpsertTurnFileSnapshotInput,
    execute: (row) => {
      const preserveExistingSnapshot = row.preserveExistingSnapshot === true ? 1 : 0;
      return sql`
        INSERT INTO checkpoint_turn_file_snapshots (
          thread_id,
          turn_id,
          path,
          blob_sha,
          deleted,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.path},
          ${row.blobSha},
          ${row.deleted ? 1 : 0},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id, turn_id, path)
        DO UPDATE SET
          blob_sha = CASE
            WHEN ${preserveExistingSnapshot} = 1
             AND (
               checkpoint_turn_file_snapshots.blob_sha IS NOT NULL
               OR checkpoint_turn_file_snapshots.deleted != 0
             )
            THEN checkpoint_turn_file_snapshots.blob_sha
            ELSE excluded.blob_sha
          END,
          deleted = CASE
            WHEN ${preserveExistingSnapshot} = 1
             AND (
               checkpoint_turn_file_snapshots.blob_sha IS NOT NULL
               OR checkpoint_turn_file_snapshots.deleted != 0
             )
            THEN checkpoint_turn_file_snapshots.deleted
            ELSE excluded.deleted
          END,
          updated_at = excluded.updated_at
      `;
    },
  });

  const getSnapshotsByTurn = SqlSchema.findAll({
    Request: GetTurnFileSnapshotsByTurnInput,
    Result: TurnFileSnapshotDbRow,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          path,
          blob_sha AS "blobSha",
          deleted,
          updated_at AS "updatedAt"
        FROM checkpoint_turn_file_snapshots
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
        ORDER BY path ASC
      `,
  });

  const deleteSnapshotsByTurn = SqlSchema.void({
    Request: DeleteTurnFileSnapshotsByTurnInput,
    execute: ({ threadId, turnId }) =>
      sql`
        DELETE FROM checkpoint_turn_file_snapshots
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
      `,
  });

  const deleteSnapshotsByThread = SqlSchema.void({
    Request: DeleteTurnFileSnapshotsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM checkpoint_turn_file_snapshots
        WHERE thread_id = ${threadId}
      `,
  });

  const upsertSnapshot: TurnFileSnapshotsShape["upsertSnapshot"] = (input) =>
    upsertSnapshotRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("TurnFileSnapshots.upsertSnapshot:query")),
    );

  const getByTurn: TurnFileSnapshotsShape["getByTurn"] = (input) =>
    getSnapshotsByTurn(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "TurnFileSnapshots.getByTurn:query",
          "TurnFileSnapshots.getByTurn:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(mapSnapshotRow)),
    );

  const deleteByTurn: TurnFileSnapshotsShape["deleteByTurn"] = (input) =>
    deleteSnapshotsByTurn(input).pipe(
      Effect.mapError(toPersistenceSqlError("TurnFileSnapshots.deleteByTurn:query")),
    );

  const deleteByThread: TurnFileSnapshotsShape["deleteByThread"] = (input) =>
    deleteSnapshotsByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("TurnFileSnapshots.deleteByThread:query")),
    );

  return {
    upsertSnapshot,
    getByTurn,
    deleteByTurn,
    deleteByThread,
  } satisfies TurnFileSnapshotsShape;
});

export const TurnFileSnapshotsLive = Layer.effect(TurnFileSnapshots, makeTurnFileSnapshots);
