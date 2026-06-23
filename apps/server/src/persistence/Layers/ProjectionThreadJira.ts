// EMPOWERRD: fork-owned side-table repository for thread Jira associations.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadJiraInput,
  GetProjectionThreadJiraInput,
  ProjectionThreadJira,
  ProjectionThreadJiraRepository,
  type ProjectionThreadJiraRepositoryShape,
} from "../Services/ProjectionThreadJira.ts";

const makeProjectionThreadJiraRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadJira,
    execute: (row) => sql`
      INSERT INTO projection_thread_jira (thread_id, jira_key, updated_at)
      VALUES (${row.threadId}, ${row.jiraKey}, ${row.updatedAt})
      ON CONFLICT (thread_id)
      DO UPDATE SET
        jira_key = excluded.jira_key,
        updated_at = excluded.updated_at
    `,
  });

  const getRowByThreadId = SqlSchema.findOneOption({
    Request: GetProjectionThreadJiraInput,
    Result: ProjectionThreadJira,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        jira_key AS "jiraKey",
        updated_at AS "updatedAt"
      FROM projection_thread_jira
      WHERE thread_id = ${threadId}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadJira,
    execute: () => sql`
      SELECT
        thread_id AS "threadId",
        jira_key AS "jiraKey",
        updated_at AS "updatedAt"
      FROM projection_thread_jira
      ORDER BY updated_at DESC, thread_id ASC
    `,
  });

  const deleteRowByThreadId = SqlSchema.void({
    Request: DeleteProjectionThreadJiraInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_jira
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadJiraRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadJiraRepository.upsert:query")),
    );

  const getByThreadId: ProjectionThreadJiraRepositoryShape["getByThreadId"] = (input) =>
    getRowByThreadId(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadJiraRepository.getByThreadId:query")),
    );

  const listAll: ProjectionThreadJiraRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadJiraRepository.listAll:query")),
    );

  const deleteByThreadId: ProjectionThreadJiraRepositoryShape["deleteByThreadId"] = (input) =>
    deleteRowByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadJiraRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    listAll,
    deleteByThreadId,
  } satisfies ProjectionThreadJiraRepositoryShape;
});

export const ProjectionThreadJiraRepositoryLive = Layer.effect(
  ProjectionThreadJiraRepository,
  makeProjectionThreadJiraRepository,
);
