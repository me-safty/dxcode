import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { WorkflowEventStoreError } from "../Services/Errors.ts";
import {
  WorkflowEnvironmentsReadCapability,
  WorkflowVcsCapability,
} from "../Services/WorkflowCapabilities.ts";
import {
  WorktreePort,
  type WorktreeHandle,
  type WorktreePortShape,
} from "../Services/WorktreePort.ts";

interface TicketProjectRow {
  readonly projectId: string;
}

const toWorktreeError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

const wrapSql = <A>(message: string, effect: Effect.Effect<A, SqlError>) =>
  effect.pipe(Effect.mapError(toWorktreeError(message)));

const safePathSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "-");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const environments = yield* WorkflowEnvironmentsReadCapability;
  const vcs = yield* WorkflowVcsCapability;
  const path = yield* Path.Path;

  const projectIdForTicket = (ticketId: string) =>
    wrapSql(
      "ticket project lookup failed",
      sql<TicketProjectRow>`
        SELECT board.project_id AS "projectId"
        FROM p_workflow_boards_projection_ticket AS ticket
        INNER JOIN p_workflow_boards_projection_board AS board
          ON board.board_id = ticket.board_id
        WHERE ticket.ticket_id = ${ticketId}
        LIMIT 1
      `,
    ).pipe(
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row?.projectId
          ? Effect.succeed(row.projectId)
          : Effect.fail(
              new WorkflowEventStoreError({
                message: `project id not found for ticket ${ticketId}`,
              }),
            );
      }),
    );

  const ensureWorktree: WorktreePortShape["ensureWorktree"] = (ticketId) =>
    Effect.gen(function* () {
      const projectId = yield* projectIdForTicket(ticketId as string);
      const project = yield* environments
        .getProjectById(ProjectId.make(projectId))
        .pipe(Effect.mapError(toWorktreeError("project lookup failed")));
      if (project === null) {
        return yield* new WorkflowEventStoreError({
          message: `project not found for ticket ${ticketId}`,
        });
      }

      const repoRoot = project.workspaceRoot;
      const worktreeRef = `workflow/${ticketId}`;
      const refs = yield* vcs
        .listRefs({ repoRoot })
        .pipe(Effect.mapError(toWorktreeError("worktree ref lookup failed")));
      const existing = refs.find((ref) => !ref.isRemote && ref.name === worktreeRef);
      if (existing?.worktreePath) {
        return {
          repoRoot,
          worktreeRef,
          path: existing.worktreePath,
          projectId,
        } satisfies WorktreeHandle;
      }

      const worktreePath = path.join(
        repoRoot,
        ".t3",
        "worktrees",
        safePathSegment(`workflow-${ticketId}`),
      );
      const result = yield* vcs
        .createWorktree(
          existing
            ? {
                repoRoot,
                ref: worktreeRef,
                path: worktreePath,
              }
            : {
                repoRoot,
                ref: "HEAD",
                newBranch: worktreeRef,
                path: worktreePath,
              },
        )
        .pipe(Effect.mapError(toWorktreeError("worktree creation failed")));

      return {
        repoRoot,
        worktreeRef: result.worktree.refName,
        path: result.worktree.path,
        projectId,
      } satisfies WorktreeHandle;
    });

  return { ensureWorktree } satisfies WorktreePortShape;
});

export const WorktreePortLive = Layer.effect(WorktreePort, make);
