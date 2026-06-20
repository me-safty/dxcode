import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { IsoDateTime, NonNegativeInt } from "@t3tools/contracts";

import { type ProjectionRepositoryError, toPersistenceSqlError } from "./Errors.ts";

/**
 * ProjectionStateRepository - Projection repository interface for projector cursors.
 *
 * Owns persistence operations for projection cursor state used to resume
 * incremental event projection.
 *
 * @module ProjectionStateRepository
 */

export const ProjectionState = Schema.Struct({
  projector: Schema.String,
  lastAppliedSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ProjectionState = typeof ProjectionState.Type;

export const GetProjectionStateInput = Schema.Struct({
  projector: Schema.String,
});
export type GetProjectionStateInput = typeof GetProjectionStateInput.Type;

/**
 * ProjectionStateRepository - Service tag for projection cursor persistence.
 */
export class ProjectionStateRepository extends Context.Service<
  ProjectionStateRepository,
  {
    /**
     * Insert or replace a projection cursor row.
     *
     * Upserts by projector name.
     */
    readonly upsert: (row: ProjectionState) => Effect.Effect<void, ProjectionRepositoryError>;

    /**
     * Read projection cursor state for a projector key.
     */
    readonly getByProjector: (
      input: GetProjectionStateInput,
    ) => Effect.Effect<Option.Option<ProjectionState>, ProjectionRepositoryError>;

    /**
     * List all projector cursor rows.
     */
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<ProjectionState>,
      ProjectionRepositoryError
    >;

    /**
     * Read the minimum applied sequence across all projectors.
     *
     * Returns `null` when no projector state rows exist.
     */
    readonly minLastAppliedSequence: () => Effect.Effect<number | null, ProjectionRepositoryError>;
  }
>()("t3/persistence/ProjectionState/ProjectionStateRepository") {}

const MinLastAppliedSequenceRowSchema = Schema.Struct({
  minLastAppliedSequence: Schema.NullOr(NonNegativeInt),
});

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionStateRow = SqlSchema.void({
    Request: ProjectionState,
    execute: (row) =>
      sql`
        INSERT INTO projection_state (
          projector,
          last_applied_sequence,
          updated_at
        )
        VALUES (
          ${row.projector},
          ${row.lastAppliedSequence},
          ${row.updatedAt}
        )
        ON CONFLICT (projector)
        DO UPDATE SET
          last_applied_sequence = excluded.last_applied_sequence,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionStateRow = SqlSchema.findOneOption({
    Request: GetProjectionStateInput,
    Result: ProjectionState,
    execute: ({ projector }) =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
        WHERE projector = ${projector}
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionState,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
        ORDER BY projector ASC
      `,
  });

  const readMinLastAppliedSequence = SqlSchema.findOne({
    Request: Schema.Void,
    Result: MinLastAppliedSequenceRowSchema,
    execute: () =>
      sql`
        SELECT
          MIN(last_applied_sequence) AS "minLastAppliedSequence"
        FROM projection_state
      `,
  });

  const upsert: ProjectionStateRepository["Service"]["upsert"] = (row) =>
    upsertProjectionStateRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.upsert:query")),
    );

  const getByProjector: ProjectionStateRepository["Service"]["getByProjector"] = (input) =>
    getProjectionStateRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.getByProjector:query")),
    );

  const listAll: ProjectionStateRepository["Service"]["listAll"] = () =>
    listProjectionStateRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionStateRepository.listAll:query")),
    );

  const minLastAppliedSequence: ProjectionStateRepository["Service"]["minLastAppliedSequence"] =
    () =>
      readMinLastAppliedSequence(undefined).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionStateRepository.minLastAppliedSequence:query"),
        ),
        Effect.map((row) => row.minLastAppliedSequence),
      );

  return {
    upsert,
    getByProjector,
    listAll,
    minLastAppliedSequence,
  } satisfies ProjectionStateRepository["Service"];
});

export const layer = Layer.effect(ProjectionStateRepository, make);
