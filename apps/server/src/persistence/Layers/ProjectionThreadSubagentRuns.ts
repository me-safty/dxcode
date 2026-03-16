import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Schema, Struct } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionThreadSubagentRunsInput,
  ProjectionThreadSubagentRun,
  ProjectionThreadSubagentRunRepository,
  type ProjectionThreadSubagentRunRepositoryShape,
} from "../Services/ProjectionThreadSubagentRuns.ts";

const ProjectionThreadSubagentRunDbRowSchema = ProjectionThreadSubagentRun.mapFields(
  Struct.assign({
    report: Schema.NullOr(Schema.fromJsonString(ProjectionThreadSubagentRun.fields.report)),
  }),
);

const makeProjectionThreadSubagentRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadSubagentRunRow = SqlSchema.void({
    Request: ProjectionThreadSubagentRun,
    execute: (row) => sql`
      INSERT INTO projection_thread_subagent_runs (
        run_id,
        parent_thread_id,
        subagent_thread_id,
        skill_id,
        skill_title,
        task,
        status,
        branch,
        worktree_path,
        report_json,
        last_error,
        created_at,
        updated_at,
        completed_at,
        accepted_at
      )
      VALUES (
        ${row.runId},
        ${row.parentThreadId},
        ${row.subagentThreadId},
        ${row.skillId},
        ${row.skillTitle},
        ${row.task},
        ${row.status},
        ${row.branch},
        ${row.worktreePath},
        ${JSON.stringify(row.report)},
        ${row.lastError},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.completedAt},
        ${row.acceptedAt}
      )
      ON CONFLICT (run_id)
      DO UPDATE SET
        parent_thread_id = excluded.parent_thread_id,
        subagent_thread_id = excluded.subagent_thread_id,
        skill_id = excluded.skill_id,
        skill_title = excluded.skill_title,
        task = excluded.task,
        status = excluded.status,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        report_json = excluded.report_json,
        last_error = excluded.last_error,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        accepted_at = excluded.accepted_at
    `,
  });

  const listProjectionThreadSubagentRunRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentRunsInput,
    Result: ProjectionThreadSubagentRunDbRowSchema,
    execute: ({ parentThreadId }) => sql`
      SELECT
        run_id AS "runId",
        parent_thread_id AS "parentThreadId",
        subagent_thread_id AS "subagentThreadId",
        skill_id AS "skillId",
        skill_title AS "skillTitle",
        task,
        status,
        branch,
        worktree_path AS "worktreePath",
        report_json AS "report",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        completed_at AS "completedAt",
        accepted_at AS "acceptedAt"
      FROM projection_thread_subagent_runs
      WHERE parent_thread_id = ${parentThreadId}
      ORDER BY created_at ASC, run_id ASC
    `,
  });

  const upsert: ProjectionThreadSubagentRunRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadSubagentRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadSubagentRunRepository.upsert:query")),
    );

  const listByParentThreadId: ProjectionThreadSubagentRunRepositoryShape["listByParentThreadId"] = (
    input,
  ) =>
    listProjectionThreadSubagentRunRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentRunRepository.listByParentThreadId:query"),
      ),
    );

  return {
    upsert,
    listByParentThreadId,
  } satisfies ProjectionThreadSubagentRunRepositoryShape;
});

export const ProjectionThreadSubagentRunRepositoryLive = Layer.effect(
  ProjectionThreadSubagentRunRepository,
  makeProjectionThreadSubagentRunRepository,
);
