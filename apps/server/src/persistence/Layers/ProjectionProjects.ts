import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";

import {
  DeleteProjectionProjectInput,
  GetProjectionProjectInput,
  ProjectionProject,
  ProjectionProjectRepository,
  type ProjectionProjectRepositoryShape,
} from "../Services/ProjectionProjects.ts";
import { ProjectScript } from "@t3tools/contracts";

// Makes sure that JSON columns are parsed from the JSON strings the DB returns
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    components: Schema.NullOr(Schema.fromJsonString(Schema.Array(Schema.String))),
    labels: Schema.NullOr(Schema.fromJsonString(Schema.Array(Schema.String))),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionProjectRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProjectRow = SqlSchema.void({
    Request: ProjectionProjectDbRowSchema,
    execute: (row) =>
      sql`
            INSERT INTO projection_projects (
              project_id,
              title,
              workspace_root,
              default_model,
              scripts_json,
              created_at,
              updated_at,
              deleted_at,
              ticket_key,
              jira_status,
              priority,
              jira_url,
              components_json,
              labels_json,
              assignee,
              reporter,
              description,
              parent_key,
              suggested_repo,
              note,
              last_accessed_at,
              archived_at
            )
            VALUES (
              ${row.projectId},
              ${row.title},
              ${row.workspaceRoot},
              ${row.defaultModel},
              ${row.scripts},
              ${row.createdAt},
              ${row.updatedAt},
              ${row.deletedAt},
              ${row.ticketKey},
              ${row.jiraStatus},
              ${row.priority},
              ${row.jiraUrl},
              ${row.components},
              ${row.labels},
              ${row.assignee},
              ${row.reporter},
              ${row.description},
              ${row.parentKey},
              ${row.suggestedRepo},
              ${row.note},
              ${row.lastAccessedAt},
              ${row.archivedAt}
            )
            ON CONFLICT (project_id)
            DO UPDATE SET
              title = excluded.title,
              workspace_root = excluded.workspace_root,
              default_model = excluded.default_model,
              scripts_json = excluded.scripts_json,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              deleted_at = excluded.deleted_at,
              ticket_key = excluded.ticket_key,
              jira_status = excluded.jira_status,
              priority = excluded.priority,
              jira_url = excluded.jira_url,
              components_json = excluded.components_json,
              labels_json = excluded.labels_json,
              assignee = excluded.assignee,
              reporter = excluded.reporter,
              description = excluded.description,
              parent_key = excluded.parent_key,
              suggested_repo = excluded.suggested_repo,
              note = excluded.note,
              last_accessed_at = excluded.last_accessed_at,
              archived_at = excluded.archived_at
          `,
  });

  const getProjectionProjectRow = SqlSchema.findOneOption({
    Request: GetProjectionProjectInput,
    Result: ProjectionProjectDbRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model AS "defaultModel",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          ticket_key AS "ticketKey",
          jira_status AS "jiraStatus",
          priority,
          jira_url AS "jiraUrl",
          components_json AS "components",
          labels_json AS "labels",
          assignee,
          reporter,
          description,
          parent_key AS "parentKey",
          suggested_repo AS "suggestedRepo",
          note,
          last_accessed_at AS "lastAccessedAt",
          archived_at AS "archivedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const listProjectionProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model AS "defaultModel",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          ticket_key AS "ticketKey",
          jira_status AS "jiraStatus",
          priority,
          jira_url AS "jiraUrl",
          components_json AS "components",
          labels_json AS "labels",
          assignee,
          reporter,
          description,
          parent_key AS "parentKey",
          suggested_repo AS "suggestedRepo",
          note,
          last_accessed_at AS "lastAccessedAt",
          archived_at AS "archivedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const deleteProjectionProjectRow = SqlSchema.void({
    Request: DeleteProjectionProjectInput,
    execute: ({ projectId }) =>
      sql`
        DELETE FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const upsert: ProjectionProjectRepositoryShape["upsert"] = (row) =>
    upsertProjectionProjectRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectRepository.upsert:query",
          "ProjectionProjectRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ProjectionProjectRepositoryShape["getById"] = (input) =>
    getProjectionProjectRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectRepository.getById:query",
          "ProjectionProjectRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionProject>)),
        }),
      ),
    );

  const listAll: ProjectionProjectRepositoryShape["listAll"] = () =>
    listProjectionProjectRows().pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectRepository.listAll:query",
          "ProjectionProjectRepository.listAll:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionProject>>),
    );

  const deleteById: ProjectionProjectRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionProjectRepositoryShape;
});

export const ProjectionProjectRepositoryLive = Layer.effect(
  ProjectionProjectRepository,
  makeProjectionProjectRepository,
);
