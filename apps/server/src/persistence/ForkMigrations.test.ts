// EMPOWERRD: regression test for the fork-migration tracking-table design.
// Guards the auth-500 class of bug: a fork migration must NOT raise upstream's
// effect_sql_migrations max-id pointer (which would silently skip later
// upstream migrations). Fork migrations live in their own `fork_migrations`
// table with their own max pointer.
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "./Migrations.ts";
import { forkMigrationEntries } from "./ForkMigrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const tableExists = (sql: SqlClient.SqlClient) => (name: string) =>
  sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}
  `.pipe(Effect.map((rows) => rows.length > 0));

layer("ForkMigrations", (it) => {
  it.effect("runs fork migrations in a separate tracking table without touching upstream's", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const exists = tableExists(sql);

      yield* runMigrations();

      // Fork side-table and both tracking tables exist.
      assert.isTrue(yield* exists("projection_thread_jira"), "projection_thread_jira table exists");
      assert.isTrue(yield* exists("effect_sql_migrations"), "upstream tracking table exists");
      assert.isTrue(yield* exists("fork_migrations"), "fork tracking table exists");

      // The fork migration did NOT bump upstream's max-id pointer. This is the
      // invariant that lets future upstream migrations (33, 34, ...) still run.
      const [upstream] = yield* sql<{ readonly maxId: number }>`
        SELECT MAX(migration_id) AS "maxId" FROM effect_sql_migrations
      `;
      const upstreamMaxId = Math.max(...migrationEntries.map(([id]) => id));
      assert.strictEqual(upstream?.maxId, upstreamMaxId);

      // The fork tracking table has only its own ids.
      const [fork] = yield* sql<{ readonly maxId: number }>`
        SELECT MAX(migration_id) AS "maxId" FROM fork_migrations
      `;
      const forkMaxId = Math.max(...forkMigrationEntries.map(([id]) => id));
      assert.strictEqual(fork?.maxId, forkMaxId);
    }),
  );

  it.effect("is idempotent across repeated full runs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations();
      yield* runMigrations();

      const [fork] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count" FROM fork_migrations
      `;
      assert.strictEqual(fork?.count, forkMigrationEntries.length);
    }),
  );
});
