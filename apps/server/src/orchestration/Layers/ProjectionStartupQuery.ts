import { ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";
import {
  GetProjectionAutoBootstrapStateInput,
  ProjectionStartupQuery,
  type ProjectionAutoBootstrapState,
  type ProjectionStartupQueryShape,
} from "../Services/ProjectionStartupQuery.ts";

const ProjectionStartupCountsRow = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});

const ProjectionStartupProjectRow = Schema.Struct({
  projectId: ProjectId,
  defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
});

const ProjectionStartupThreadRow = Schema.Struct({
  threadId: ThreadId,
});

const EMPTY_AUTO_BOOTSTRAP_STATE: ProjectionAutoBootstrapState = {
  project: null,
  threadId: null,
};

function toStartupQuerySqlError(operation: string) {
  return (cause: unknown): ProjectionRepositoryError => toPersistenceSqlError(operation)(cause);
}

const makeProjectionStartupQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readStartupCountsRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionStartupCountsRow,
    execute: () =>
      sql`
        SELECT
          (
            SELECT COUNT(*)
            FROM projection_projects
            WHERE deleted_at IS NULL
          ) AS "projectCount",
          (
            SELECT COUNT(*)
            FROM projection_threads
            WHERE deleted_at IS NULL
          ) AS "threadCount"
      `,
  });

  const findAutoBootstrapProjectRow = SqlSchema.findOneOption({
    Request: GetProjectionAutoBootstrapStateInput,
    Result: ProjectionStartupProjectRow,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const findAutoBootstrapThreadRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: ProjectionStartupThreadRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getStartupCounts: ProjectionStartupQueryShape["getStartupCounts"] = () =>
    readStartupCountsRow(undefined).pipe(
      Effect.mapError(toStartupQuerySqlError("ProjectionStartupQuery.getStartupCounts:query")),
    );

  const getAutoBootstrapState: ProjectionStartupQueryShape["getAutoBootstrapState"] = (input) =>
    Effect.gen(function* () {
      const projectOption = yield* findAutoBootstrapProjectRow(input).pipe(
        Effect.mapError(
          toStartupQuerySqlError("ProjectionStartupQuery.getAutoBootstrapState:projectQuery"),
        ),
      );

      if (Option.isNone(projectOption)) {
        return EMPTY_AUTO_BOOTSTRAP_STATE;
      }

      const threadOption = yield* findAutoBootstrapThreadRow({
        projectId: projectOption.value.projectId,
      }).pipe(
        Effect.mapError(
          toStartupQuerySqlError("ProjectionStartupQuery.getAutoBootstrapState:threadQuery"),
        ),
      );

      return {
        project: {
          id: projectOption.value.projectId,
          defaultModelSelection: projectOption.value.defaultModelSelection,
        },
        threadId: Option.match(threadOption, {
          onNone: () => null,
          onSome: (row) => row.threadId,
        }),
      } satisfies ProjectionAutoBootstrapState;
    });

  return {
    getStartupCounts,
    getAutoBootstrapState,
  } satisfies ProjectionStartupQueryShape;
});

export const OrchestrationProjectionStartupQueryLive = Layer.effect(
  ProjectionStartupQuery,
  makeProjectionStartupQuery,
);
