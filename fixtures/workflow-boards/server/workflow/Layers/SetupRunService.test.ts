import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { MigrationsLive } from "../../persistence/Migrations.ts";
import { WorkflowEventStoreError } from "../Services/Errors.ts";
import { SetupRunService, SetupTerminalPort } from "../Services/SetupRunService.ts";
import { SetupRunServiceLive } from "./SetupRunService.ts";

const terminalLayer = (
  awaitExit: SetupTerminalPort["Service"]["awaitExit"],
): Layer.Layer<SetupTerminalPort> =>
  Layer.succeed(SetupTerminalPort, {
    launch: () => Effect.succeed({ threadId: "workflow-setup:/tmp/wt-1", terminalId: "term-1" }),
    awaitExit,
  });

const layer = (awaitExit: SetupTerminalPort["Service"]["awaitExit"]) =>
  SetupRunServiceLive.pipe(
    Layer.provideMerge(terminalLayer(awaitExit)),
    Layer.provideMerge(MigrationsLive),
    Layer.provideMerge(SqlitePersistenceMemory),
  );

describe("SetupRunServiceLive", () => {
  it.effect("marks non-zero setup exits as failed", () =>
    Effect.gen(function* () {
      const setup = yield* SetupRunService;

      const result = yield* setup.runSetup(
        "ticket-setup-nonzero" as never,
        "wt-1",
        "/tmp/wt-1",
        "setup-nonzero" as never,
      );

      assert.deepEqual(result, { status: "failed", exitCode: 1 });
    }).pipe(Effect.provide(layer(() => Effect.succeed({ exitCode: 1 })))),
  );

  it.effect("marks terminal errors as failed, not timed_out", () =>
    Effect.gen(function* () {
      const setup = yield* SetupRunService;
      const sql = yield* SqlClient.SqlClient;

      const result = yield* setup.runSetup(
        "ticket-setup-error" as never,
        "wt-2",
        "/tmp/wt-2",
        "setup-error" as never,
      );

      assert.deepEqual(result, { status: "failed", exitCode: null });
      const rows = yield* sql<{ readonly status: string; readonly exitCode: number | null }>`
        SELECT status, exit_code AS "exitCode"
        FROM p_workflow_boards_setup_run
        WHERE ticket_id = 'ticket-setup-error'
      `;
      assert.deepEqual(rows[0], { status: "failed", exitCode: null });
    }).pipe(
      Effect.provide(
        layer(() => Effect.fail(new WorkflowEventStoreError({ message: "setup terminal closed" }))),
      ),
    ),
  );

  it.effect("marks explicit setup wait timeouts as timed_out", () =>
    Effect.gen(function* () {
      const setup = yield* SetupRunService;

      const result = yield* setup.runSetup(
        "ticket-setup-timeout" as never,
        "wt-3",
        "/tmp/wt-3",
        "setup-timeout" as never,
      );

      assert.deepEqual(result, { status: "timed_out", exitCode: -1 });
    }).pipe(
      Effect.provide(
        layer(() =>
          Effect.fail(new WorkflowEventStoreError({ message: "setup terminal wait timed out" })),
        ),
      ),
    ),
  );
});
