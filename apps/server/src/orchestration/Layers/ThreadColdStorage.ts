// @effect-diagnostics nodeBuiltinImport:off
import * as NodeUtil from "node:util";
import * as NodeZlib from "node:zlib";

import { ThreadId } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { parseAttachmentIdFromRelativePath } from "../../attachmentStore.ts";
import {
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ThreadColdStorage,
  ThreadColdStorageError,
  type ThreadColdStorageShape,
} from "../Services/ThreadColdStorage.ts";

const gzipAsync = NodeUtil.promisify(NodeZlib.gzip);
const gunzipAsync = NodeUtil.promisify(NodeZlib.gunzip);
const ARCHIVE_SCHEMA = "cold_archive";
const ARCHIVE_VERSION = 1;
const ROW_CHUNK_SIZE = 250;

type SqlRow = Record<string, unknown>;

class ArchiveCodecError extends Data.TaggedError("ArchiveCodecError")<{
  readonly cause: unknown;
}> {}

const THREAD_TABLES = [
  ["orchestration_events", "stream_id"],
  ["orchestration_command_receipts", "aggregate_id"],
  ["checkpoint_diff_blobs", "thread_id"],
  ["provider_session_runtime", "thread_id"],
  ["projection_thread_messages", "thread_id"],
  ["projection_thread_activities", "thread_id"],
  ["projection_thread_sessions", "thread_id"],
  ["projection_turns", "thread_id"],
  ["projection_pending_approvals", "thread_id"],
  ["projection_thread_proposed_plans", "thread_id"],
] as const;

function storageError(operation: string, threadId: string, cause: unknown) {
  return new ThreadColdStorageError({ operation, threadId, cause });
}

function encodeRows(rows: ReadonlyArray<SqlRow>): Uint8Array {
  return Buffer.from(JSON.stringify(rows), "utf8");
}

function decodeRows(data: Uint8Array): ReadonlyArray<SqlRow> {
  return JSON.parse(Buffer.from(data).toString("utf8")) as ReadonlyArray<SqlRow>;
}

const compress = (data: Uint8Array) =>
  Effect.tryPromise({
    try: () => gzipAsync(data),
    catch: (cause) => new ArchiveCodecError({ cause }),
  }).pipe(Effect.map((value) => new Uint8Array(value)));

const decompress = (data: Uint8Array) =>
  Effect.tryPromise({
    try: () => gunzipAsync(data),
    catch: (cause) => new ArchiveCodecError({ cause }),
  }).pipe(Effect.map((value) => new Uint8Array(value)));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;

  yield* sql.unsafe(`ATTACH DATABASE ? AS ${ARCHIVE_SCHEMA}`, [config.archiveDbPath]);
  yield* sql.unsafe(`PRAGMA ${ARCHIVE_SCHEMA}.auto_vacuum = INCREMENTAL`);
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${ARCHIVE_SCHEMA}.archive_threads (
      thread_id TEXT PRIMARY KEY,
      root_thread_id TEXT NOT NULL,
      archive_version INTEGER NOT NULL,
      archived_at TEXT NOT NULL,
      original_bytes INTEGER NOT NULL,
      compressed_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${ARCHIVE_SCHEMA}.archive_thread_chunks (
      thread_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (thread_id, chunk_index)
    )
  `);
  yield* sql.unsafe(`
    CREATE INDEX IF NOT EXISTS ${ARCHIVE_SCHEMA}.idx_archive_thread_chunks_thread
    ON archive_thread_chunks(thread_id, chunk_index)
  `);

  const attachmentEntriesForThread = Effect.fn("attachmentEntriesForThread")(function* (
    threadId: string,
  ) {
    const segment = toSafeThreadAttachmentSegment(threadId);
    if (!segment) return [] as string[];
    const entries = yield* fs
      .readDirectory(config.attachmentsDir, { recursive: false })
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    return entries.filter((entry) => {
      const attachmentId = parseAttachmentIdFromRelativePath(entry);
      return attachmentId !== null && parseThreadSegmentFromAttachmentId(attachmentId) === segment;
    });
  });

  const removeAttachments = Effect.fn("removeThreadAttachments")(function* (threadId: string) {
    const entries = yield* attachmentEntriesForThread(threadId);
    yield* Effect.forEach(
      entries,
      (entry) => fs.remove(path.join(config.attachmentsDir, entry), { force: true }),
      { concurrency: 4, discard: true },
    );
  });

  const removeProviderLogsImpl = Effect.fn("removeProviderLogs")(function* (threadId: string) {
    const segment = toSafeThreadAttachmentSegment(threadId);
    if (!segment) return;
    const baseName = `${segment}.log`;
    const entries = yield* fs
      .readDirectory(config.providerLogsDir, { recursive: false })
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    yield* Effect.forEach(
      entries.filter(
        (entry) =>
          entry === baseName || new RegExp(`^${baseName.replace(".", "\\.")}\\.\\d+$`).test(entry),
      ),
      (entry) => fs.remove(path.join(config.providerLogsDir, entry), { force: true }),
      { concurrency: 4, discard: true },
    );
  });

  const reclaimFreePages = Effect.fn("reclaimThreadStorageFreePages")(function* () {
    yield* sql.unsafe("PRAGMA main.incremental_vacuum(2048)");
    yield* sql.unsafe(`PRAGMA ${ARCHIVE_SCHEMA}.incremental_vacuum(2048)`);
  });

  const insertChunk = Effect.fn("insertArchiveChunk")(function* (input: {
    readonly threadId: string;
    readonly chunkIndex: number;
    readonly kind: string;
    readonly rowCount: number;
    readonly data: Uint8Array;
  }) {
    yield* sql.unsafe(
      `INSERT INTO ${ARCHIVE_SCHEMA}.archive_thread_chunks
        (thread_id, chunk_index, kind, row_count, data)
       VALUES (?, ?, ?, ?, ?)`,
      [input.threadId, input.chunkIndex, input.kind, input.rowCount, input.data],
    );
  });

  const archiveImpl = Effect.fn("archiveThreadImpl")(function* (threadId: ThreadId) {
    const manifestRows = (yield* sql.unsafe(
      `SELECT root_thread_id, archived_at, status
       FROM thread_archive_manifests
       WHERE thread_id = ?`,
      [threadId],
    )) as ReadonlyArray<SqlRow>;
    const threadRows = (yield* sql.unsafe(
      `SELECT thread_id AS root_thread_id, archived_at
       FROM projection_threads
       WHERE thread_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
      [threadId],
    )) as ReadonlyArray<SqlRow>;
    const source = manifestRows[0] ?? threadRows[0];
    if (!source) return;
    if (source.status === "cold") return;
    const rootThreadId = String(source.root_thread_id ?? threadId);
    const archivedAt = String(source.archived_at ?? DateTime.formatIso(yield* DateTime.now));

    yield* sql.unsafe(
      `INSERT INTO thread_archive_manifests
        (thread_id, root_thread_id, status, archive_version, archived_at, updated_at, error)
       VALUES (?, ?, 'archiving', ?, ?, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(thread_id) DO UPDATE SET
         root_thread_id = excluded.root_thread_id,
         status = 'archiving',
         archive_version = excluded.archive_version,
         archived_at = excluded.archived_at,
         updated_at = CURRENT_TIMESTAMP,
         error = NULL`,
      [threadId, rootThreadId, ARCHIVE_VERSION, archivedAt],
    );
    yield* sql.unsafe(`DELETE FROM ${ARCHIVE_SCHEMA}.archive_thread_chunks WHERE thread_id = ?`, [
      threadId,
    ]);
    yield* sql.unsafe(`DELETE FROM ${ARCHIVE_SCHEMA}.archive_threads WHERE thread_id = ?`, [
      threadId,
    ]);

    let chunkIndex = 0;
    let originalBytes = 0;
    let compressedBytes = 0;
    for (const [table, keyColumn] of THREAD_TABLES) {
      let lastRowId = 0;
      while (true) {
        const rows = (yield* sql.unsafe(
          `SELECT rowid AS __archive_rowid, *
           FROM ${table}
           WHERE ${keyColumn} = ? AND rowid > ?
           ORDER BY rowid ASC
           LIMIT ${ROW_CHUNK_SIZE}`,
          [threadId, lastRowId],
        )) as ReadonlyArray<SqlRow>;
        if (rows.length === 0) break;
        const normalizedRows = rows.map((row) => {
          const { __archive_rowid, ...stored } = row;
          lastRowId = Number(__archive_rowid);
          return stored;
        });
        const encoded = encodeRows(normalizedRows);
        const compressed = yield* compress(encoded);
        yield* insertChunk({
          threadId,
          chunkIndex,
          kind: `table:${table}`,
          rowCount: normalizedRows.length,
          data: compressed,
        });
        chunkIndex += 1;
        originalBytes += encoded.byteLength;
        compressedBytes += compressed.byteLength;
      }
    }

    const attachmentEntries = yield* attachmentEntriesForThread(threadId);
    for (const entry of attachmentEntries) {
      const bytes = yield* fs.readFile(path.join(config.attachmentsDir, entry));
      const compressed = yield* compress(bytes);
      yield* insertChunk({
        threadId,
        chunkIndex,
        kind: `attachment:${entry}`,
        rowCount: 1,
        data: compressed,
      });
      chunkIndex += 1;
      originalBytes += bytes.byteLength;
      compressedBytes += compressed.byteLength;
    }

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql.unsafe(
          `INSERT INTO ${ARCHIVE_SCHEMA}.archive_threads
            (thread_id, root_thread_id, archive_version, archived_at, original_bytes,
             compressed_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [threadId, rootThreadId, ARCHIVE_VERSION, archivedAt, originalBytes, compressedBytes],
        );
        for (const [table, keyColumn] of [...THREAD_TABLES].toReversed()) {
          yield* sql.unsafe(`DELETE FROM ${table} WHERE ${keyColumn} = ?`, [threadId]);
        }
        yield* sql.unsafe(
          `UPDATE thread_archive_manifests
           SET status = 'cold', original_bytes = ?, compressed_bytes = ?,
               updated_at = CURRENT_TIMESTAMP, error = NULL
           WHERE thread_id = ?`,
          [originalBytes, compressedBytes, threadId],
        );
      }),
    );

    yield* removeAttachments(threadId);
    yield* removeProviderLogsImpl(threadId);
    yield* reclaimFreePages();
  });

  const insertRows = Effect.fn("restoreArchiveRows")(function* (
    table: string,
    rows: ReadonlyArray<SqlRow>,
  ) {
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => "?").join(", ");
      yield* sql.unsafe(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
        columns.map((column) => row[column]),
      );
    }
  });

  const restoreThread = Effect.fn("restoreArchivedThread")(function* (threadId: ThreadId) {
    const chunks = (yield* sql.unsafe(
      `SELECT chunk_index, kind, data
       FROM ${ARCHIVE_SCHEMA}.archive_thread_chunks
       WHERE thread_id = ?
       ORDER BY chunk_index ASC`,
      [threadId],
    )) as ReadonlyArray<SqlRow>;
    if (chunks.length === 0) return false;

    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const chunk of chunks) {
          const kind = String(chunk.kind);
          const data = yield* decompress(chunk.data as Uint8Array);
          if (!kind.startsWith("table:")) continue;
          yield* insertRows(kind.slice("table:".length), decodeRows(data));
        }
        yield* sql.unsafe(
          `UPDATE thread_archive_manifests
           SET status = 'restored', updated_at = CURRENT_TIMESTAMP, error = NULL
           WHERE thread_id = ?`,
          [threadId],
        );
      }),
    );

    for (const chunk of chunks) {
      const kind = String(chunk.kind);
      if (!kind.startsWith("attachment:")) continue;
      const entry = kind.slice("attachment:".length);
      if (entry.length === 0 || entry.includes("/") || entry.includes("\\")) continue;
      const data = yield* decompress(chunk.data as Uint8Array);
      yield* fs.writeFile(path.join(config.attachmentsDir, entry), data);
    }
    return true;
  });

  const resolveTreeRoot = Effect.fn("resolveArchiveTreeRoot")(function* (threadId: ThreadId) {
    const rows = (yield* sql.unsafe(
      `SELECT COALESCE(
          (SELECT root_thread_id FROM thread_archive_manifests WHERE thread_id = ?),
          (SELECT thread_id FROM projection_threads WHERE thread_id = ?),
          ?
        ) AS root_thread_id`,
      [threadId, threadId, threadId],
    )) as ReadonlyArray<SqlRow>;
    return ThreadId.make(String(rows[0]?.root_thread_id ?? threadId));
  });

  const restoreTreeImpl = Effect.fn("restoreArchiveTreeImpl")(function* (threadId: ThreadId) {
    const rootThreadId = yield* resolveTreeRoot(threadId);
    const rows = (yield* sql.unsafe(
      `SELECT thread_id
       FROM thread_archive_manifests
       WHERE root_thread_id = ? AND status IN ('cold', 'restored')
       ORDER BY CASE WHEN thread_id = ? THEN 1 ELSE 0 END, thread_id ASC`,
      [rootThreadId, rootThreadId],
    )) as ReadonlyArray<SqlRow>;
    let restored = false;
    for (const row of rows) {
      restored = (yield* restoreThread(ThreadId.make(String(row.thread_id)))) || restored;
    }
    return restored;
  });

  const finishRestoreTreeImpl = Effect.fn("finishRestoreArchiveTreeImpl")(function* (
    threadId: ThreadId,
  ) {
    const rootThreadId = yield* resolveTreeRoot(threadId);
    const rows = (yield* sql.unsafe(
      `SELECT thread_id FROM thread_archive_manifests WHERE root_thread_id = ? AND status = 'restored'`,
      [rootThreadId],
    )) as ReadonlyArray<SqlRow>;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const row of rows) {
          const restoredThreadId = String(row.thread_id);
          yield* sql.unsafe(
            `DELETE FROM ${ARCHIVE_SCHEMA}.archive_thread_chunks WHERE thread_id = ?`,
            [restoredThreadId],
          );
          yield* sql.unsafe(`DELETE FROM ${ARCHIVE_SCHEMA}.archive_threads WHERE thread_id = ?`, [
            restoredThreadId,
          ]);
          yield* sql.unsafe(`DELETE FROM thread_archive_manifests WHERE thread_id = ?`, [
            restoredThreadId,
          ]);
        }
      }),
    );
    yield* sql.unsafe(`PRAGMA ${ARCHIVE_SCHEMA}.incremental_vacuum(2048)`);
  });

  const deleteImpl = Effect.fn("deleteThreadPermanentlyImpl")(function* (threadId: ThreadId) {
    yield* sql.unsafe(
      `INSERT OR IGNORE INTO thread_cleanup_queue (thread_id, reason, created_at)
       VALUES (?, 'deleted', CURRENT_TIMESTAMP)`,
      [threadId],
    );
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql.unsafe(
          `UPDATE projection_thread_proposed_plans
           SET implementation_thread_id = NULL
           WHERE implementation_thread_id = ?`,
          [threadId],
        );
        yield* sql.unsafe(
          `UPDATE projection_turns
           SET source_proposed_plan_thread_id = NULL, source_proposed_plan_id = NULL
           WHERE source_proposed_plan_thread_id = ?`,
          [threadId],
        );
        for (const [table, keyColumn] of [...THREAD_TABLES].toReversed()) {
          yield* sql.unsafe(`DELETE FROM ${table} WHERE ${keyColumn} = ?`, [threadId]);
        }
        yield* sql.unsafe(`DELETE FROM projection_threads WHERE thread_id = ?`, [threadId]);
        yield* sql.unsafe(
          `DELETE FROM ${ARCHIVE_SCHEMA}.archive_thread_chunks WHERE thread_id = ?`,
          [threadId],
        );
        yield* sql.unsafe(`DELETE FROM ${ARCHIVE_SCHEMA}.archive_threads WHERE thread_id = ?`, [
          threadId,
        ]);
        yield* sql.unsafe(`DELETE FROM thread_archive_manifests WHERE thread_id = ?`, [threadId]);
        yield* sql.unsafe(`DELETE FROM thread_cleanup_queue WHERE thread_id = ?`, [threadId]);
      }),
    );
    yield* removeAttachments(threadId);
    yield* removeProviderLogsImpl(threadId);
    yield* reclaimFreePages();
  });

  const compactLegacyStorageImpl = Effect.fn("compactLegacyThreadStorage")(function* () {
    const rows = (yield* sql.unsafe(
      `SELECT status FROM thread_storage_maintenance
       WHERE task = 'compact-legacy-thread-storage'`,
    )) as ReadonlyArray<SqlRow>;
    if (rows[0]?.status === "complete") return;

    yield* sql.unsafe(
      `UPDATE thread_storage_maintenance
       SET status = 'running', updated_at = CURRENT_TIMESTAMP, error = NULL
       WHERE task = 'compact-legacy-thread-storage'`,
    );
    yield* sql.unsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    yield* sql.unsafe("PRAGMA main.auto_vacuum = INCREMENTAL");
    yield* sql.unsafe("VACUUM main");
    yield* reclaimFreePages();
    yield* sql.unsafe(
      `UPDATE thread_storage_maintenance
       SET status = 'complete', updated_at = CURRENT_TIMESTAMP, error = NULL
       WHERE task = 'compact-legacy-thread-storage'`,
    );
  });

  const wrap = <A, E>(operation: string, threadId: ThreadId, effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError((cause) => storageError(operation, threadId, cause)));

  const listIds = (query: string, operation: string) =>
    sql.unsafe(query).pipe(
      Effect.map((rows) =>
        (rows as ReadonlyArray<SqlRow>).map((row) => ThreadId.make(String(row.thread_id))),
      ),
      Effect.mapError((cause) => storageError(operation, "startup", cause)),
    );

  return {
    archiveThread: (threadId) => wrap("archive", threadId, archiveImpl(threadId)),
    restoreTree: (threadId) => wrap("restore", threadId, restoreTreeImpl(threadId)),
    finishRestoreTree: (threadId) =>
      wrap("finish-restore", threadId, finishRestoreTreeImpl(threadId)),
    deleteThread: (threadId) => wrap("delete", threadId, deleteImpl(threadId)),
    removeProviderLogs: (threadId) =>
      wrap("remove-provider-logs", threadId, removeProviderLogsImpl(threadId)),
    compactLegacyStorage: compactLegacyStorageImpl().pipe(
      Effect.mapError((cause) => storageError("compact-legacy-storage", "startup", cause)),
    ),
    listPendingArchiveThreadIds: listIds(
      `SELECT thread_id FROM thread_archive_manifests WHERE status IN ('pending', 'archiving') ORDER BY archived_at ASC, thread_id ASC`,
      "list-pending-archives",
    ),
    listPendingDeleteThreadIds: listIds(
      `SELECT thread_id FROM thread_cleanup_queue WHERE reason = 'deleted' ORDER BY created_at ASC, thread_id ASC`,
      "list-pending-deletes",
    ),
  } satisfies ThreadColdStorageShape;
});

export const ThreadColdStorageLive = Layer.effect(ThreadColdStorage, make);
