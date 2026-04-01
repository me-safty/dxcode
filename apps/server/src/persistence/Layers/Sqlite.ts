import { Effect, Layer, FileSystem, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { openSync, readSync, closeSync } from "node:fs";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

// First 16 bytes of every valid SQLite database file
const SQLITE_MAGIC = "SQLite format 3\0";

/** Check whether the file at `dbPath` starts with the SQLite magic header. */
const isSqliteFileValid = (dbPath: string): Effect.Effect<boolean> =>
  Effect.sync(() => {
    try {
      const fd = openSync(dbPath, "r");
      try {
        const buf = Buffer.alloc(16);
        const bytesRead = readSync(fd, buf, 0, 16, 0);
        if (bytesRead < 16) return false;
        return buf.toString("ascii", 0, 16) === SQLITE_MAGIC;
      } finally {
        closeSync(fd);
      }
    } catch {
      return false;
    }
  });

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = (
  config: RuntimeSqliteLayerConfig,
): Layer.Layer<SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const runtime = process.versions.bun !== undefined ? "bun" : "node";
    const loader = defaultSqliteClientLoaders[runtime];
    const clientModule = yield* Effect.promise<Loader>(loader);
    return clientModule.layer(config);
  }).pipe(Layer.unwrap);

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* runMigrations();
  }),
);

export const makeSqlitePersistenceLive = (dbPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

    // Detect and recover from a corrupted database file.
    // A valid SQLite file must start with "SQLite format 3\0".
    // If the header is invalid, back up the corrupted file and let
    // a fresh database be created so the app can start.
    const fileExists = yield* fs.exists(dbPath);
    if (fileExists) {
      const valid = yield* isSqliteFileValid(dbPath);
      if (!valid) {
        const backupPath = `${dbPath}.corrupted.${Date.now()}`;
        yield* Effect.logWarning(
          `Corrupted database detected at ${dbPath}. ` +
            `Backing up to ${backupPath} and creating a fresh database. ` +
            `Session history will be reset.`,
        );
        yield* fs.rename(dbPath, backupPath);
        // Remove stale WAL/SHM journal files from the corrupted database
        yield* fs.remove(`${dbPath}-wal`).pipe(Effect.ignore);
        yield* fs.remove(`${dbPath}-shm`).pipe(Effect.ignore);
      }
    }

    return Layer.provideMerge(setup, makeRuntimeSqliteLayer({ filename: dbPath }));
  }).pipe(Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
