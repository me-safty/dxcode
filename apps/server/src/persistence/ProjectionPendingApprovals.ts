import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  ApprovalRequestId,
  IsoDateTime,
  ProjectionPendingApprovalDecision,
  ProjectionPendingApprovalStatus,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import { type ProjectionRepositoryError, toPersistenceSqlError } from "./Errors.ts";

/**
 * ProjectionPendingApprovalRepository - Repository interface for pending approvals.
 *
 * Owns persistence operations for projected approval requests awaiting user
 * decisions.
 *
 * @module ProjectionPendingApprovalRepository
 */

export const ProjectionPendingApproval = Schema.Struct({
  requestId: ApprovalRequestId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  status: ProjectionPendingApprovalStatus,
  decision: ProjectionPendingApprovalDecision,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionPendingApproval = typeof ProjectionPendingApproval.Type;

export const ListProjectionPendingApprovalsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionPendingApprovalsInput = typeof ListProjectionPendingApprovalsInput.Type;

export const GetProjectionPendingApprovalInput = Schema.Struct({
  requestId: ApprovalRequestId,
});
export type GetProjectionPendingApprovalInput = typeof GetProjectionPendingApprovalInput.Type;

export const DeleteProjectionPendingApprovalInput = Schema.Struct({
  requestId: ApprovalRequestId,
});
export type DeleteProjectionPendingApprovalInput = typeof DeleteProjectionPendingApprovalInput.Type;

/**
 * ProjectionPendingApprovalRepository - Service tag for pending approval persistence.
 */
export class ProjectionPendingApprovalRepository extends Context.Service<
  ProjectionPendingApprovalRepository,
  {
    /**
     * Insert or replace a projected pending approval row.
     *
     * Upserts by `requestId`.
     */
    readonly upsert: (
      row: ProjectionPendingApproval,
    ) => Effect.Effect<void, ProjectionRepositoryError>;

    /**
     * List pending approvals for a thread.
     *
     * Returned in ascending creation order.
     */
    readonly listByThreadId: (
      input: ListProjectionPendingApprovalsInput,
    ) => Effect.Effect<ReadonlyArray<ProjectionPendingApproval>, ProjectionRepositoryError>;

    /**
     * Read a pending approval row by request id.
     */
    readonly getByRequestId: (
      input: GetProjectionPendingApprovalInput,
    ) => Effect.Effect<Option.Option<ProjectionPendingApproval>, ProjectionRepositoryError>;

    /**
     * Delete a pending approval row by request id.
     */
    readonly deleteByRequestId: (
      input: DeleteProjectionPendingApprovalInput,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
  }
>()("t3/persistence/ProjectionPendingApprovals/ProjectionPendingApprovalRepository") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionPendingApprovalRow = SqlSchema.void({
    Request: ProjectionPendingApproval,
    execute: (row) =>
      sql`
        INSERT INTO projection_pending_approvals (
          request_id,
          thread_id,
          turn_id,
          status,
          decision,
          created_at,
          resolved_at
        )
        VALUES (
          ${row.requestId},
          ${row.threadId},
          ${row.turnId},
          ${row.status},
          ${row.decision},
          ${row.createdAt},
          ${row.resolvedAt}
        )
        ON CONFLICT (request_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          status = excluded.status,
          decision = excluded.decision,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `,
  });

  const listProjectionPendingApprovalRows = SqlSchema.findAll({
    Request: ListProjectionPendingApprovalsInput,
    Result: ProjectionPendingApproval,
    execute: ({ threadId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, request_id ASC
      `,
  });

  const getProjectionPendingApprovalRow = SqlSchema.findOneOption({
    Request: GetProjectionPendingApprovalInput,
    Result: ProjectionPendingApproval,
    execute: ({ requestId }) =>
      sql`
        SELECT
          request_id AS "requestId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          status,
          decision,
          created_at AS "createdAt",
          resolved_at AS "resolvedAt"
        FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `,
  });

  const deleteProjectionPendingApprovalRow = SqlSchema.void({
    Request: DeleteProjectionPendingApprovalInput,
    execute: ({ requestId }) =>
      sql`
        DELETE FROM projection_pending_approvals
        WHERE request_id = ${requestId}
      `,
  });

  const upsert: ProjectionPendingApprovalRepository["Service"]["upsert"] = (row) =>
    upsertProjectionPendingApprovalRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionPendingApprovalRepository.upsert:query")),
    );

  const listByThreadId: ProjectionPendingApprovalRepository["Service"]["listByThreadId"] = (
    input,
  ) =>
    listProjectionPendingApprovalRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.listByThreadId:query"),
      ),
    );

  const getByRequestId: ProjectionPendingApprovalRepository["Service"]["getByRequestId"] = (
    input,
  ) =>
    getProjectionPendingApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.getByRequestId:query"),
      ),
    );

  const deleteByRequestId: ProjectionPendingApprovalRepository["Service"]["deleteByRequestId"] = (
    input,
  ) =>
    deleteProjectionPendingApprovalRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingApprovalRepository.deleteByRequestId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    getByRequestId,
    deleteByRequestId,
  } satisfies ProjectionPendingApprovalRepository["Service"];
});

export const layer = Layer.effect(ProjectionPendingApprovalRepository, make);
