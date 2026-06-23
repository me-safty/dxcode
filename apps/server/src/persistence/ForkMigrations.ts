/**
 * EMPOWERRD: fork-owned migrations.
 *
 * These run through a SECOND Migrator instance against their own tracking table
 * (`fork_migrations`). The Effect Migrator runs by MAX applied id, so sharing
 * upstream's `effect_sql_migrations` table would make a high fork id silently
 * skip later upstream migrations (and a low id collide with upstream's next
 * additions). A separate tracking table gives the fork its own max pointer —
 * fork ids start at 1 in their own namespace and never interfere with upstream.
 *
 * Mirrors the shape of the upstream `migrationEntries` / `makeMigrationLoader`
 * in Migrations.ts so the wiring there is a single fenced call.
 */
import * as Migrator from "effect/unstable/sql/Migrator";

import ForkMigration0001 from "./Migrations/fork/001_ProjectionThreadJira.ts";

/** Tracking table name for fork-owned migrations (kept separate from upstream's). */
export const FORK_MIGRATIONS_TABLE = "fork_migrations";

export const forkMigrationEntries = [[1, "ProjectionThreadJira", ForkMigration0001]] as const;

export const makeForkMigrationLoader = () =>
  Migrator.fromRecord(
    Object.fromEntries(
      forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );
