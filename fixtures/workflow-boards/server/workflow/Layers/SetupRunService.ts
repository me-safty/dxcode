import { ProjectId } from "@t3tools/contracts";
import { projectScriptRuntimeEnv, setupProjectScript } from "@t3tools/shared/projectScripts";
import type { TerminalAttachStreamEvent, TerminalSessionSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { WorkflowTerminalsCapability } from "../Services/ScriptCancelRegistry.ts";
import {
  SetupRunService,
  SetupTerminalPort,
  type SetupRunServiceShape,
  type SetupTerminalPortShape,
  type SetupStatus,
} from "../Services/SetupRunService.ts";
import { WorkflowEnvironmentsReadCapability } from "../Services/WorkflowCapabilities.ts";

const SETUP_TIMEOUT_MS = 10 * 60 * 1000;

const toSetupError = (message: string) => (cause: unknown) =>
  new WorkflowEventStoreError({ message, cause });

const wrapSql = <A>(effect: Effect.Effect<A, SqlError>) =>
  effect.pipe(Effect.mapError(toSetupError("setup op failed")));

interface SetupRunRow {
  readonly status: string;
  readonly exitCode: number | null;
  readonly worktreeRef: string | null;
}

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const normalizeStatus = (exitCode: number): SetupStatus =>
  exitCode === 0 ? "completed" : exitCode === -1 ? "timed_out" : "failed";

const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const fields = error as { readonly message?: unknown; readonly cause?: unknown };
    const cause =
      fields.cause === undefined || fields.cause === null ? "" : ` ${errorMessage(fields.cause)}`;
    return `${typeof fields.message === "string" ? fields.message : String(error)}${cause}`;
  }
  return String(error);
};

const failedExitFromError = (
  error: unknown,
): { readonly status: SetupStatus; readonly exitCode: number | null } =>
  errorMessage(error).toLowerCase().includes("timed out")
    ? { status: "timed_out", exitCode: -1 }
    : { status: "failed", exitCode: null };

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const terminal = yield* SetupTerminalPort;

  const runSetup: SetupRunServiceShape["runSetup"] = (
    ticketId,
    worktreeRef,
    worktreePath,
    setupRunId,
    projectId,
  ) =>
    Effect.gen(function* () {
      const existing = yield* wrapSql(sql<SetupRunRow>`
        SELECT
          status,
          exit_code AS "exitCode",
          worktree_ref AS "worktreeRef"
        FROM p_workflow_boards_setup_run
        WHERE ticket_id = ${ticketId}
      `);
      if (existing[0]?.status === "completed" && existing[0].worktreeRef === worktreeRef) {
        return { status: "completed", exitCode: existing[0].exitCode };
      }

      yield* wrapSql(sql`
        INSERT INTO p_workflow_boards_setup_run (
          setup_run_id,
          ticket_id,
          worktree_ref,
          status,
          started_at
        )
        VALUES (${setupRunId}, ${ticketId}, ${worktreeRef}, 'running', ${yield* nowIso})
        ON CONFLICT(ticket_id) DO UPDATE SET
          setup_run_id = excluded.setup_run_id,
          worktree_ref = excluded.worktree_ref,
          status = 'running',
          started_at = excluded.started_at,
          finished_at = NULL,
          exit_code = NULL
      `);

      const { threadId: launchedThreadId, terminalId } = yield* terminal.launch({
        worktreePath,
        ...(projectId === undefined ? {} : { projectId }),
      });
      const exit =
        terminalId === null
          ? { status: "completed" as SetupStatus, exitCode: 0 }
          : yield* terminal
              .awaitExit({ threadId: launchedThreadId, terminalId, timeoutMs: SETUP_TIMEOUT_MS })
              .pipe(
                Effect.map(({ exitCode }) => ({ status: normalizeStatus(exitCode), exitCode })),
                Effect.catch((cause) => Effect.succeed(failedExitFromError(cause))),
              );

      yield* wrapSql(sql`
        UPDATE p_workflow_boards_setup_run
        SET status = ${exit.status},
            exit_code = ${exit.exitCode},
            finished_at = ${yield* nowIso}
        WHERE ticket_id = ${ticketId}
      `);

      return { status: exit.status, exitCode: exit.exitCode };
    });

  return { runSetup } satisfies SetupRunServiceShape;
});

export const SetupRunServiceLive = Layer.effect(SetupRunService, make);

const completeFromSnapshot = (
  snapshot: TerminalSessionSnapshot,
  complete: (exitCode: number) => Effect.Effect<void>,
) => (snapshot.status === "exited" ? complete(snapshot.exitCode ?? 1) : Effect.void);

const awaitTerminalExit = (
  terminals: WorkflowTerminalsCapability["Service"],
  input: {
    readonly threadId: string;
    readonly terminalId: string | null;
    readonly timeoutMs?: number;
  },
): Effect.Effect<{ readonly exitCode: number }, WorkflowEventStoreError> => {
  const { terminalId } = input;
  if (terminalId === null) {
    return Effect.succeed({ exitCode: 0 });
  }

  return Effect.gen(function* () {
    const done = yield* Deferred.make<{ readonly exitCode: number }, WorkflowEventStoreError>();
    const complete = (exitCode: number) => Deferred.succeed(done, { exitCode }).pipe(Effect.asVoid);
    const fail = (message: string) =>
      Deferred.fail(done, new WorkflowEventStoreError({ message })).pipe(Effect.asVoid);
    const handle = { threadId: input.threadId, terminalId };
    const unsubscribe = yield* terminals
      .observe(handle, (event: TerminalAttachStreamEvent) => {
        if (event.type === "snapshot") {
          return completeFromSnapshot(event.snapshot, complete);
        }
        if (event.type === "exited") {
          return complete(event.exitCode ?? 1);
        }
        if (event.type === "error") {
          return fail(`setup terminal error: ${event.message}`);
        }
        if (event.type === "closed") {
          return fail("setup terminal closed");
        }
        return Effect.void;
      })
      .pipe(Effect.mapError(toSetupError("setup terminal observe failed")));

    const wait = Deferred.await(done);
    const timed =
      input.timeoutMs === undefined
        ? wait
        : wait.pipe(
            Effect.timeoutOption(Duration.millis(input.timeoutMs)),
            Effect.flatMap((result) =>
              Option.match(result, {
                onNone: () =>
                  terminals.kill(handle).pipe(
                    Effect.ignore,
                    Effect.andThen(
                      Effect.fail(
                        new WorkflowEventStoreError({
                          message: "setup terminal wait timed out",
                        }),
                      ),
                    ),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
    return yield* timed.pipe(Effect.ensuring(Effect.sync(unsubscribe)));
  });
};

export const SetupTerminalPortLive = Layer.effect(
  SetupTerminalPort,
  Effect.gen(function* () {
    const environments = yield* WorkflowEnvironmentsReadCapability;
    const terminals = yield* WorkflowTerminalsCapability;

    return {
      launch: (input) =>
        Effect.gen(function* () {
          const project =
            input.projectId === undefined
              ? input.projectCwd === undefined
                ? null
                : yield* environments
                    .resolveProjectByWorkspaceRoot(input.projectCwd)
                    .pipe(Effect.mapError(toSetupError("setup project lookup failed")))
              : yield* environments
                  .getProjectById(ProjectId.make(input.projectId))
                  .pipe(Effect.mapError(toSetupError("setup project lookup failed")));
          if (project === null) {
            return yield* new WorkflowEventStoreError({
              message: "project not found for setup script",
            });
          }
          const script = setupProjectScript(project.scripts);
          const threadId = input.threadId ?? `workflow-setup:${input.worktreePath}`;
          if (script === null) {
            return { threadId, terminalId: null };
          }

          const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
          const spawned = yield* terminals
            .spawn({
              terminalId,
              cwd: input.worktreePath,
              command: "sh",
              args: ["-c", script.command],
              env: projectScriptRuntimeEnv({
                project: { cwd: project.workspaceRoot },
                worktreePath: input.worktreePath,
              }),
            })
            .pipe(Effect.mapError(toSetupError("setup terminal spawn failed")));
          yield* terminals.sendInput({ ...spawned.handle, data: "exit $?\r" }).pipe(Effect.ignore);
          return {
            threadId: spawned.handle.threadId,
            terminalId: spawned.handle.terminalId,
          };
        }),
      awaitExit: (input) => awaitTerminalExit(terminals, input),
    } satisfies SetupTerminalPortShape;
  }),
);
