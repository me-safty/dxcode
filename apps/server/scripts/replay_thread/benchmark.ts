import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OrchestrationEvent,
  ThreadId,
  type OrchestrationEvent as OrchestrationEventType,
} from "@t3tools/contracts";
import { Database } from "bun:sqlite";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../src/config.ts";
import { OrchestrationEventStoreLive } from "../../src/persistence/Layers/OrchestrationEventStore.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../src/persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../../src/project/Services/RepositoryIdentityResolver.ts";
import { OrchestrationProjectionPipelineLive } from "../../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionPipeline } from "../../src/orchestration/Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  buildTimingSamples,
  calculateTimingStats,
  checksumRows,
  classifyReplayEvent,
} from "./core.ts";

interface CliOptions {
  readonly sourceDb: string;
  readonly threadId: string;
  readonly target: "memory" | "file";
  readonly targetFile: string | null;
  readonly verify: "none" | "messages" | "full";
  readonly diffMessages: number;
  readonly diffOnly: boolean;
  readonly compare: "none" | "assistant-streaming";
  readonly legacyMode: "sampled" | "full";
  readonly legacySamplePerWindow: number;
  readonly windowSize: number;
  readonly sampleEvery: number;
  readonly progressEvery: number;
  readonly limit: number | null;
  readonly keepTarget: boolean;
}

interface SourceEventRow {
  readonly sequence: number;
  readonly eventId: string;
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly commandId: string | null;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly payload: string;
  readonly metadata: string;
}

interface SourceProjectRow {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly scriptsJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly defaultModelSelectionJson: string | null;
}

interface SourceMessageRow {
  readonly messageId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly role: string;
  readonly text: string;
  readonly attachmentsJson: string | null;
  readonly isStreaming: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AssistantStreamingEventRow {
  readonly messageId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly role: string;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type SqlBindingRecord = Record<string, string | number | bigint | boolean | Uint8Array | null>;

const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let sourceDb: string | undefined;
  let threadId: string | undefined;
  let target: CliOptions["target"] = "memory";
  let targetFile: string | null = null;
  let verify: CliOptions["verify"] = "messages";
  let diffMessages = 0;
  let diffOnly = false;
  let compare: CliOptions["compare"] = "none";
  let legacyMode: CliOptions["legacyMode"] = "sampled";
  let legacySamplePerWindow = 500;
  let windowSize = 10_000;
  let sampleEvery = 1_000;
  let progressEvery = 10_000;
  let limit: number | null = null;
  let keepTarget = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--source-db":
        sourceDb = next();
        break;
      case "--thread-id":
        threadId = next();
        break;
      case "--target": {
        const value = next();
        if (value !== "memory" && value !== "file") {
          throw new Error("--target must be memory or file");
        }
        target = value;
        break;
      }
      case "--target-file":
        targetFile = next();
        target = "file";
        break;
      case "--verify": {
        const value = next();
        if (value !== "none" && value !== "messages" && value !== "full") {
          throw new Error("--verify must be none, messages, or full");
        }
        verify = value;
        break;
      }
      case "--diff-messages":
        diffMessages = Number(next());
        break;
      case "--diff-only":
        diffOnly = true;
        break;
      case "--compare": {
        const value = next();
        if (value !== "assistant-streaming") {
          throw new Error("--compare must be assistant-streaming");
        }
        compare = value;
        break;
      }
      case "--legacy-mode": {
        const value = next();
        if (value !== "sampled" && value !== "full") {
          throw new Error("--legacy-mode must be sampled or full");
        }
        legacyMode = value;
        break;
      }
      case "--legacy-sample-per-window":
        legacySamplePerWindow = Number(next());
        break;
      case "--window-size":
        windowSize = Number(next());
        break;
      case "--sample-every":
        sampleEvery = Number(next());
        break;
      case "--progress-every":
        progressEvery = Number(next());
        break;
      case "--limit":
        limit = Number(next());
        break;
      case "--keep-target":
        keepTarget = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!sourceDb) {
    throw new Error("Missing --source-db");
  }
  if (!threadId) {
    throw new Error("Missing --thread-id");
  }
  if (!Number.isFinite(sampleEvery) || sampleEvery < 1) {
    throw new Error("--sample-every must be a positive number");
  }
  if (!Number.isFinite(diffMessages) || diffMessages < 0) {
    throw new Error("--diff-messages must be zero or a positive number");
  }
  if (!Number.isFinite(progressEvery) || progressEvery < 1) {
    throw new Error("--progress-every must be a positive number");
  }
  if (!Number.isFinite(legacySamplePerWindow) || legacySamplePerWindow < 1) {
    throw new Error("--legacy-sample-per-window must be a positive number");
  }
  if (!Number.isFinite(windowSize) || windowSize < 1) {
    throw new Error("--window-size must be a positive number");
  }
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("--limit must be a positive number");
  }

  return {
    sourceDb: resolve(sourceDb),
    threadId,
    target,
    targetFile,
    verify,
    diffMessages: Math.floor(diffMessages),
    diffOnly,
    compare,
    legacyMode,
    legacySamplePerWindow: Math.floor(legacySamplePerWindow),
    windowSize: Math.floor(windowSize),
    sampleEvery: Math.floor(sampleEvery),
    progressEvery: Math.floor(progressEvery),
    limit: limit === null ? null : Math.floor(limit),
    keepTarget,
  };
}

function printUsage() {
  console.log(`Usage:
  bun apps/server/scripts/replay_thread/benchmark.ts \\
    --source-db C:\\Users\\mike\\.t3\\dev\\state.sqlite \\
    --thread-id de1c398f-5d3c-40e4-911c-2b672653cda7

Options:
  --target memory|file      Replay into an isolated in-memory DB by default.
  --target-file <path>      Replay into a temp/inspectable SQLite file.
  --verify none|messages|full
                            Verify messages by default. Full checks every table.
  --diff-messages <n>       Print the first n source-vs-event message diffs.
  --diff-only               Only run message diffing; skip projection replay.
  --compare assistant-streaming
                            Compare optimized vs legacy assistant streaming paths.
  --legacy-mode sampled|full
                            Default: sampled. Full can take hours on large threads.
  --legacy-sample-per-window <n>
                            Legacy samples per window in sampled mode. Default: 500.
  --window-size <n>         Assistant-streaming compare window size. Default: 10000.
  --sample-every <n>        Print timing windows of n events. Default: 1000.
  --progress-every <n>      Print progress every n events. Default: 10000.
  --limit <n>               Replay only the first n events for smoke testing.
  --keep-target             Keep target file when --target-file is used.
`);
}

function readSourceEvents(
  sourceDb: string,
  threadId: string,
): ReadonlyArray<OrchestrationEventType> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    const rows = db
      .query<SourceEventRow, [string]>(`
        SELECT
          sequence,
          event_id AS eventId,
          aggregate_kind AS aggregateKind,
          stream_id AS aggregateId,
          event_type AS type,
          occurred_at AS occurredAt,
          command_id AS commandId,
          causation_event_id AS causationEventId,
          correlation_id AS correlationId,
          payload_json AS payload,
          metadata_json AS metadata
        FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ?
        ORDER BY sequence ASC
      `)
      .all(threadId);
    return rows.map((row) =>
      decodeEvent({
        ...row,
        payload: JSON.parse(row.payload),
        metadata: JSON.parse(row.metadata),
      }),
    );
  } finally {
    db.close();
  }
}

function readSourceProject(sourceDb: string, threadId: string): SourceProjectRow | null {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    return (
      db
        .query<SourceProjectRow, [string]>(`
          SELECT
            p.project_id AS projectId,
            p.title,
            p.workspace_root AS workspaceRoot,
            p.scripts_json AS scriptsJson,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt,
            p.deleted_at AS deletedAt,
            p.default_model_selection_json AS defaultModelSelectionJson
          FROM projection_threads t
          JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.thread_id = ?
          LIMIT 1
        `)
        .get(threadId) ?? null
    );
  } finally {
    db.close();
  }
}

function readAssistantStreamingEvents(
  sourceDb: string,
  threadId: string,
): ReadonlyArray<AssistantStreamingEventRow> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    return db
      .query<AssistantStreamingEventRow, [string]>(`
        SELECT
          json_extract(payload_json, '$.messageId') AS messageId,
          json_extract(payload_json, '$.threadId') AS threadId,
          json_extract(payload_json, '$.turnId') AS turnId,
          json_extract(payload_json, '$.role') AS role,
          json_extract(payload_json, '$.text') AS text,
          json_extract(payload_json, '$.createdAt') AS createdAt,
          json_extract(payload_json, '$.updatedAt') AS updatedAt
        FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ?
          AND event_type = 'thread.message-sent'
          AND json_extract(payload_json, '$.role') = 'assistant'
          AND json_extract(payload_json, '$.streaming') = 1
        ORDER BY sequence ASC
      `)
      .all(threadId);
  } finally {
    db.close();
  }
}

function readSourceThreadRow(sourceDb: string, threadId: string): Record<string, unknown> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    const row = db
      .query<Record<string, unknown>, [string]>(`
        SELECT
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode,
          model_selection_json,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        FROM projection_threads
        WHERE thread_id = ?
      `)
      .get(threadId);
    if (row === null) {
      throw new Error(`Thread ${threadId} not found in source DB`);
    }
    return row;
  } finally {
    db.close();
  }
}

function readSourceActivityRows(
  sourceDb: string,
  threadId: string,
): ReadonlyArray<Record<string, unknown>> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    return db
      .query<Record<string, unknown>, [string]>(`
        SELECT
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at,
          sequence
        FROM projection_thread_activities
        WHERE thread_id = ?
      `)
      .all(threadId);
  } finally {
    db.close();
  }
}

function readSourceChecksumRows(
  sourceDb: string,
  table: string,
  threadId: string,
): ReadonlyArray<Record<string, unknown>> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    return db.query<Record<string, unknown>, [string]>(checksumQuery(table)).all(threadId);
  } finally {
    db.close();
  }
}

function readSourceMessageRows(
  sourceDb: string,
  threadId: string,
): ReadonlyArray<SourceMessageRow> {
  const db = new Database(sourceDb, { readonly: true, strict: true });
  try {
    return db
      .query<SourceMessageRow, [string]>(`
        SELECT
          message_id AS messageId,
          thread_id AS threadId,
          turn_id AS turnId,
          role,
          text,
          attachments_json AS attachmentsJson,
          is_streaming AS isStreaming,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM projection_thread_messages
        WHERE thread_id = ?
        ORDER BY created_at, message_id
      `)
      .all(threadId);
  } finally {
    db.close();
  }
}

function stringifyAttachments(attachments: unknown): string | null {
  return attachments === undefined ? null : JSON.stringify(attachments);
}

function deriveMessageRowsFromEvents(
  events: ReadonlyArray<OrchestrationEventType>,
): ReadonlyArray<SourceMessageRow> {
  const messages = new Map<string, SourceMessageRow>();
  for (const event of events) {
    if (event.type !== "thread.message-sent") {
      continue;
    }
    const previous = messages.get(event.payload.messageId);
    const text =
      previous === undefined
        ? event.payload.text
        : event.payload.streaming
          ? `${previous.text}${event.payload.text}`
          : event.payload.text.length === 0
            ? previous.text
            : event.payload.text;
    const attachments =
      event.payload.attachments !== undefined
        ? event.payload.attachments
        : previous?.attachmentsJson !== null && previous?.attachmentsJson !== undefined
          ? JSON.parse(previous.attachmentsJson)
          : undefined;
    messages.set(event.payload.messageId, {
      messageId: event.payload.messageId,
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
      role: event.payload.role,
      text,
      attachmentsJson: stringifyAttachments(attachments),
      isStreaming: event.payload.streaming ? 1 : 0,
      createdAt: previous?.createdAt ?? event.payload.createdAt,
      updatedAt: event.payload.updatedAt,
    });
  }
  return [...messages.values()].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId.localeCompare(right.messageId),
  );
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > 180) {
    return `${value.slice(0, 180)}...`;
  }
  return value;
}

function buildMessageDiffs(input: {
  readonly sourceRows: ReadonlyArray<SourceMessageRow>;
  readonly expectedRows: ReadonlyArray<SourceMessageRow>;
  readonly limit: number;
}): ReadonlyArray<Record<string, unknown>> {
  if (input.limit <= 0) {
    return [];
  }
  const sourceById = new Map(input.sourceRows.map((row) => [row.messageId, row] as const));
  const expectedById = new Map(input.expectedRows.map((row) => [row.messageId, row] as const));
  const diffs: Array<Record<string, unknown>> = [];
  const keys = [
    "threadId",
    "turnId",
    "role",
    "text",
    "attachmentsJson",
    "isStreaming",
    "createdAt",
    "updatedAt",
  ] as const;

  for (const [messageId, expected] of expectedById) {
    const source = sourceById.get(messageId);
    if (source === undefined) {
      diffs.push({ messageId, kind: "missing-source" });
    } else {
      for (const key of keys) {
        if (source[key] !== expected[key]) {
          const doubled =
            key === "text" &&
            typeof source.text === "string" &&
            source.text.length === expected.text.length * 2 &&
            source.text === `${expected.text}${expected.text}`;
          diffs.push({
            messageId,
            key,
            source: compactValue(source[key]),
            expected: compactValue(expected[key]),
            sourceLength: typeof source[key] === "string" ? source[key].length : undefined,
            expectedLength: typeof expected[key] === "string" ? expected[key].length : undefined,
            ...(doubled ? { looksDoubled: true } : {}),
          });
          break;
        }
      }
    }
    if (diffs.length >= input.limit) {
      return diffs;
    }
  }

  for (const messageId of sourceById.keys()) {
    if (!expectedById.has(messageId)) {
      diffs.push({ messageId, kind: "extra-source" });
    }
    if (diffs.length >= input.limit) {
      return diffs;
    }
  }

  return diffs;
}

function checksumQuery(table: string): string {
  switch (table) {
    case "projection_threads":
      return `
        SELECT
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode,
          model_selection_json,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        FROM projection_threads
        WHERE thread_id = ?
        ORDER BY thread_id
      `;
    case "projection_thread_messages":
      return `
        SELECT *
        FROM projection_thread_messages
        WHERE thread_id = ?
        ORDER BY created_at, message_id
      `;
    case "projection_thread_activities":
      return `
        SELECT *
        FROM projection_thread_activities
        WHERE thread_id = ?
        ORDER BY sequence, created_at, activity_id
      `;
    case "projection_turns":
      return `
        SELECT
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json,
          source_proposed_plan_thread_id,
          source_proposed_plan_id
        FROM projection_turns
        WHERE thread_id = ?
        ORDER BY requested_at, row_id
      `;
    case "projection_thread_sessions":
      return `
        SELECT *
        FROM projection_thread_sessions
        WHERE thread_id = ?
        ORDER BY thread_id
      `;
    case "projection_thread_proposed_plans":
      return `
        SELECT *
        FROM projection_thread_proposed_plans
        WHERE thread_id = ?
        ORDER BY created_at, plan_id
      `;
    case "projection_pending_approvals":
      return `
        SELECT *
        FROM projection_pending_approvals
        WHERE thread_id = ?
        ORDER BY created_at, request_id
      `;
    default:
      throw new Error(`Unsupported checksum table: ${table}`);
  }
}

const readTargetChecksumRows = (
  sql: SqlClient.SqlClient,
  table: (typeof checksumTables)[number],
  threadId: string,
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, Error> => {
  const rows = (() => {
    switch (table) {
      case "projection_threads":
        return sql<Record<string, unknown>>`
        SELECT
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode,
          model_selection_json,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        FROM projection_threads
        WHERE thread_id = ${threadId}
        ORDER BY thread_id
      `;
      case "projection_thread_messages":
        return sql<Record<string, unknown>>`
        SELECT *
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at, message_id
      `;
      case "projection_thread_activities":
        return sql<Record<string, unknown>>`
        SELECT *
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY sequence, created_at, activity_id
      `;
      case "projection_turns":
        return sql<Record<string, unknown>>`
        SELECT
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json,
          source_proposed_plan_thread_id,
          source_proposed_plan_id
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY requested_at, row_id
      `;
      case "projection_thread_sessions":
        return sql<Record<string, unknown>>`
        SELECT *
        FROM projection_thread_sessions
        WHERE thread_id = ${threadId}
        ORDER BY thread_id
      `;
      case "projection_thread_proposed_plans":
        return sql<Record<string, unknown>>`
        SELECT *
        FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        ORDER BY created_at, plan_id
      `;
      case "projection_pending_approvals":
        return sql<Record<string, unknown>>`
        SELECT *
        FROM projection_pending_approvals
        WHERE thread_id = ${threadId}
        ORDER BY created_at, request_id
      `;
    }
  })();
  return rows.pipe(
    Effect.mapError((cause) =>
      cause instanceof Error
        ? cause
        : new Error(`Failed to read target checksum rows: ${String(cause)}`),
    ),
  );
};

const checksumTables = [
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_activities",
  "projection_turns",
  "projection_thread_sessions",
  "projection_thread_proposed_plans",
  "projection_pending_approvals",
] as const;

function verifyTablesForMode(
  mode: CliOptions["verify"],
): ReadonlyArray<(typeof checksumTables)[number]> {
  switch (mode) {
    case "none":
      return [];
    case "messages":
      return ["projection_thread_messages"];
    case "full":
      return checksumTables;
  }
}

function eventTimingBucket(event: OrchestrationEventType): string {
  if (classifyReplayEvent(event) === "assistant-streaming-message") {
    return "thread.message-sent:assistant-streaming";
  }
  return event.type;
}

function makeTargetLayer(options: CliOptions, targetFile: string | null) {
  const persistence =
    options.target === "memory"
      ? SqlitePersistenceMemory
      : makeSqlitePersistenceLive(targetFile ?? makeDefaultTargetFile(options.threadId));
  const repositoryIdentityResolverLayer = Layer.succeed(RepositoryIdentityResolver, {
    resolve: () => Effect.succeed(null),
  });

  return Layer.mergeAll(
    OrchestrationProjectionPipelineLive.pipe(Layer.provideMerge(OrchestrationEventStoreLive)),
    OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provide(repositoryIdentityResolverLayer)),
  ).pipe(
    Layer.provideMerge(persistence),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-replay-benchmark-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

function makeDefaultTargetFile(threadId: string): string {
  return join(tmpdir(), `t3-thread-replay-${threadId}-${Date.now()}.sqlite`);
}

function formatMs(value: number): string {
  return value.toFixed(4);
}

function printStats(label: string, timings: ReadonlyArray<number>) {
  const stats = calculateTimingStats(timings);
  console.log(
    `${label}: count=${stats.count} total=${formatMs(stats.totalMs)}ms mean=${formatMs(
      stats.meanMs,
    )}ms p50=${formatMs(stats.p50Ms)}ms p90=${formatMs(stats.p90Ms)}ms p99=${formatMs(
      stats.p99Ms,
    )}ms max=${formatMs(stats.maxMs)}ms`,
  );
}

function divideForSpeedup(left: number, right: number): number {
  return right === 0 ? 0 : left / right;
}

function speedupStats(
  legacy: ReturnType<typeof calculateTimingStats>,
  optimized: ReturnType<typeof calculateTimingStats>,
) {
  return {
    mean: divideForSpeedup(legacy.meanMs, optimized.meanMs),
    p50: divideForSpeedup(legacy.p50Ms, optimized.p50Ms),
    p90: divideForSpeedup(legacy.p90Ms, optimized.p90Ms),
    p99: divideForSpeedup(legacy.p99Ms, optimized.p99Ms),
  };
}

function printCompareStats(input: {
  readonly label: string;
  readonly optimized: ReadonlyArray<number>;
  readonly legacy: ReadonlyArray<number>;
}) {
  const optimized = calculateTimingStats(input.optimized);
  const legacy = calculateTimingStats(input.legacy);
  const speedup = speedupStats(legacy, optimized);
  console.log(input.label);
  console.log(
    `  optimized: count=${optimized.count} mean=${formatMs(optimized.meanMs)}ms p50=${formatMs(
      optimized.p50Ms,
    )}ms p90=${formatMs(optimized.p90Ms)}ms p99=${formatMs(optimized.p99Ms)}ms max=${formatMs(
      optimized.maxMs,
    )}ms`,
  );
  console.log(
    `  legacy:    count=${legacy.count} mean=${formatMs(legacy.meanMs)}ms p50=${formatMs(
      legacy.p50Ms,
    )}ms p90=${formatMs(legacy.p90Ms)}ms p99=${formatMs(legacy.p99Ms)}ms max=${formatMs(
      legacy.maxMs,
    )}ms`,
  );
  console.log(
    `  speedup:   mean=${speedup.mean.toFixed(1)}x p50=${speedup.p50.toFixed(
      1,
    )}x p90=${speedup.p90.toFixed(1)}x p99=${speedup.p99.toFixed(1)}x`,
  );
}

function createAssistantStreamingCompareDb(input: {
  readonly thread: Record<string, unknown>;
  readonly messages?: ReadonlyArray<SourceMessageRow>;
  readonly activities?: ReadonlyArray<Record<string, unknown>>;
}) {
  const db = new Database(":memory:", { strict: true });
  db.exec(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous = OFF;
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      runtime_mode TEXT,
      interaction_mode TEXT,
      model_selection_json TEXT,
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER DEFAULT 0,
      pending_user_input_count INTEGER DEFAULT 0,
      has_actionable_proposed_plan INTEGER DEFAULT 0
    );
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      role TEXT,
      text TEXT,
      is_streaming INTEGER,
      created_at TEXT,
      updated_at TEXT,
      attachments_json TEXT
    );
    CREATE INDEX idx_messages_thread_created
      ON projection_thread_messages(thread_id, created_at, message_id);
    CREATE TABLE projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      tone TEXT,
      kind TEXT,
      summary TEXT,
      payload_json TEXT,
      created_at TEXT,
      sequence INTEGER
    );
    CREATE INDEX idx_activities_thread_sequence
      ON projection_thread_activities(thread_id, sequence, created_at, activity_id);
    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      plan_markdown TEXT,
      created_at TEXT,
      updated_at TEXT,
      implemented_at TEXT,
      implementation_thread_id TEXT
    );
    CREATE TABLE projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      status TEXT,
      decision TEXT,
      created_at TEXT,
      resolved_at TEXT
    );
  `);

  db.query(`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      deleted_at,
      runtime_mode,
      interaction_mode,
      model_selection_json,
      archived_at,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan
    )
    VALUES (
      $thread_id,
      $project_id,
      $title,
      $branch,
      $worktree_path,
      $latest_turn_id,
      $created_at,
      $updated_at,
      $deleted_at,
      $runtime_mode,
      $interaction_mode,
      $model_selection_json,
      $archived_at,
      $latest_user_message_at,
      $pending_approval_count,
      $pending_user_input_count,
      $has_actionable_proposed_plan
    )
  `).run(input.thread as SqlBindingRecord);

  if (input.messages !== undefined || input.activities !== undefined) {
    const insertMessage = db.query(`
      INSERT INTO projection_thread_messages (
        message_id,
        thread_id,
        turn_id,
        role,
        text,
        is_streaming,
        created_at,
        updated_at,
        attachments_json
      )
      VALUES (
        $messageId,
        $threadId,
        $turnId,
        $role,
        $text,
        $isStreaming,
        $createdAt,
        $updatedAt,
        $attachmentsJson
      )
    `);
    const insertActivity = db.query(`
      INSERT INTO projection_thread_activities (
        activity_id,
        thread_id,
        turn_id,
        tone,
        kind,
        summary,
        payload_json,
        created_at,
        sequence
      )
      VALUES (
        $activity_id,
        $thread_id,
        $turn_id,
        $tone,
        $kind,
        $summary,
        $payload_json,
        $created_at,
        $sequence
      )
    `);
    db.transaction(() => {
      for (const message of input.messages ?? []) {
        insertMessage.run(message as unknown as SqlBindingRecord);
      }
      for (const activity of input.activities ?? []) {
        insertActivity.run(activity as SqlBindingRecord);
      }
    })();
  }

  return db;
}

function selectSampledWindowEvents(
  events: ReadonlyArray<AssistantStreamingEventRow>,
  sampleSize: number,
): ReadonlyArray<AssistantStreamingEventRow> {
  if (events.length <= sampleSize) {
    return events;
  }
  const step = events.length / sampleSize;
  const selected: Array<AssistantStreamingEventRow> = [];
  for (let index = 0; index < sampleSize; index += 1) {
    selected.push(events[Math.floor(index * step)]!);
  }
  return selected;
}

function runAssistantStreamingCompare(options: CliOptions) {
  const events = readAssistantStreamingEvents(options.sourceDb, options.threadId).slice(
    0,
    options.limit ?? undefined,
  );
  const thread = readSourceThreadRow(options.sourceDb, options.threadId);
  const sourceMessages = readSourceMessageRows(options.sourceDb, options.threadId);
  const sourceActivities = readSourceActivityRows(options.sourceDb, options.threadId);
  const optimizedDb = createAssistantStreamingCompareDb({ thread });
  const optimizedAppend = optimizedDb.query<unknown, SqlBindingRecord>(`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      is_streaming,
      created_at,
      updated_at,
      attachments_json
    )
    VALUES (
      $messageId,
      $threadId,
      $turnId,
      $role,
      $text,
      1,
      $createdAt,
      $updatedAt,
      NULL
    )
    ON CONFLICT(message_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = projection_thread_messages.text || excluded.text,
      is_streaming = excluded.is_streaming,
      updated_at = excluded.updated_at
  `);

  const legacyDb = createAssistantStreamingCompareDb({
    thread,
    messages: sourceMessages,
    activities: sourceActivities,
  });
  const legacyGet = legacyDb.query<
    { readonly text: string; readonly createdAt: string; readonly attachmentsJson: string | null },
    [string]
  >(`
    SELECT
      text,
      created_at AS createdAt,
      attachments_json AS attachmentsJson
    FROM projection_thread_messages
    WHERE message_id = ?
  `);
  const legacyUpsert = legacyDb.query<unknown, SqlBindingRecord>(`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      turn_id,
      role,
      text,
      is_streaming,
      created_at,
      updated_at,
      attachments_json
    )
    VALUES (
      $messageId,
      $threadId,
      $turnId,
      $role,
      $nextText,
      1,
      $createdAtForWrite,
      $updatedAt,
      $attachmentsJson
    )
    ON CONFLICT(message_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = excluded.text,
      is_streaming = excluded.is_streaming,
      updated_at = excluded.updated_at,
      attachments_json = COALESCE(
        excluded.attachments_json,
        projection_thread_messages.attachments_json
      )
  `);
  const updateThread = legacyDb.query<unknown, [string, string]>(`
    UPDATE projection_threads
    SET updated_at = ?
    WHERE thread_id = ?
  `);
  const listMessages = legacyDb.query<
    { readonly role: string; readonly createdAt: string },
    [string]
  >(`
    SELECT role, created_at AS createdAt
    FROM projection_thread_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC, message_id ASC
  `);
  const listActivities = legacyDb.query<
    { readonly kind: string; readonly payloadJson: string; readonly createdAt: string },
    [string]
  >(`
    SELECT
      kind,
      payload_json AS payloadJson,
      created_at AS createdAt
    FROM projection_thread_activities
    WHERE thread_id = ?
    ORDER BY
      CASE WHEN sequence IS NULL THEN 0 ELSE 1 END,
      sequence ASC,
      created_at ASC,
      activity_id ASC
  `);
  const countApprovals = legacyDb.query<{ readonly count: number }, [string]>(`
    SELECT count(*) AS count
    FROM projection_pending_approvals
    WHERE thread_id = ?
      AND status = 'pending'
  `);
  const listPlans = legacyDb.query<
    {
      readonly planId: string;
      readonly turnId: string | null;
      readonly implementedAt: string | null;
    },
    [string]
  >(`
    SELECT
      plan_id AS planId,
      turn_id AS turnId,
      implemented_at AS implementedAt
    FROM projection_thread_proposed_plans
    WHERE thread_id = ?
    ORDER BY updated_at ASC, plan_id ASC
  `);

  const optimizedAll: Array<number> = [];
  const legacyAll: Array<number> = [];
  const windows: Array<{
    readonly label: string;
    readonly optimized: ReadonlyArray<number>;
    readonly legacy: ReadonlyArray<number>;
    readonly optimizedCount: number;
    readonly legacyCount: number;
  }> = [];

  for (let start = 0; start < events.length; start += options.windowSize) {
    const end = Math.min(events.length, start + options.windowSize);
    const windowEvents = events.slice(start, end);
    const optimizedWindow: Array<number> = [];
    for (const event of windowEvents) {
      const startedAt = performance.now();
      optimizedAppend.run(event as unknown as SqlBindingRecord);
      const elapsed = performance.now() - startedAt;
      optimizedWindow.push(elapsed);
      optimizedAll.push(elapsed);
    }

    const legacyWindowEvents =
      options.legacyMode === "full"
        ? windowEvents
        : selectSampledWindowEvents(windowEvents, options.legacySamplePerWindow);
    const legacyWindow: Array<number> = [];
    for (const event of legacyWindowEvents) {
      legacyDb.exec("BEGIN");
      const startedAt = performance.now();
      const existing = legacyGet.get(event.messageId);
      const nextText = existing === null ? event.text : `${existing.text}${event.text}`;
      legacyUpsert.run({
        ...event,
        nextText,
        attachmentsJson: existing?.attachmentsJson ?? null,
        createdAtForWrite: existing?.createdAt ?? event.createdAt,
      } as unknown as SqlBindingRecord);
      updateThread.run(event.updatedAt, event.threadId);
      const messages = listMessages.all(event.threadId);
      const activities = listActivities.all(event.threadId);
      const approvals = countApprovals.get(event.threadId)?.count ?? 0;
      const plans = listPlans.all(event.threadId);
      let latestUserMessageAt: string | null = null;
      for (const message of messages) {
        if (message.role === "user") {
          latestUserMessageAt = message.createdAt;
        }
      }
      let pendingUserInputCount = 0;
      for (const activity of activities) {
        if (activity.kind === "user-input.requested") {
          pendingUserInputCount += 1;
        }
      }
      void approvals;
      void plans;
      void latestUserMessageAt;
      void pendingUserInputCount;
      const elapsed = performance.now() - startedAt;
      legacyWindow.push(elapsed);
      legacyAll.push(elapsed);
      legacyDb.exec("ROLLBACK");
    }

    windows.push({
      label: `window ${start + 1}-${end}`,
      optimized: optimizedWindow,
      legacy: legacyWindow,
      optimizedCount: windowEvents.length,
      legacyCount: legacyWindowEvents.length,
    });
    console.log(
      `compare progress ${end}/${events.length}: optimized=${windowEvents.length} legacy=${legacyWindowEvents.length}`,
    );
  }

  console.log(`thread=${options.threadId}`);
  console.log(`sourceDb=${options.sourceDb}`);
  console.log("mode=compare assistant-streaming");
  console.log(`legacyMode=${options.legacyMode}`);
  console.log(`windowSize=${options.windowSize}`);
  console.log(`assistantStreamingEvents=${events.length}`);
  console.log(`legacySamplePerWindow=${options.legacySamplePerWindow}`);
  printCompareStats({
    label: "overall",
    optimized: optimizedAll,
    legacy: legacyAll,
  });
  for (const window of windows) {
    printCompareStats({
      label: `${window.label} optimizedEvents=${window.optimizedCount} legacyEvents=${window.legacyCount}`,
      optimized: window.optimized,
      legacy: window.legacy,
    });
  }

  optimizedDb.close();
  legacyDb.close();
}

const runReplay = (options: CliOptions, targetFile: string | null) =>
  Effect.gen(function* () {
    const sourceEvents = readSourceEvents(options.sourceDb, options.threadId).slice(
      0,
      options.limit ?? undefined,
    );
    const sourceProject = readSourceProject(options.sourceDb, options.threadId);
    if (sourceEvents.length === 0) {
      throw new Error(`No thread events found for ${options.threadId}`);
    }

    const sql = yield* SqlClient.SqlClient;
    if (sourceProject !== null) {
      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at,
          default_model_selection_json
        )
        VALUES (
          ${sourceProject.projectId},
          ${sourceProject.title},
          ${sourceProject.workspaceRoot},
          ${sourceProject.scriptsJson},
          ${sourceProject.createdAt},
          ${sourceProject.updatedAt},
          ${sourceProject.deletedAt},
          ${sourceProject.defaultModelSelectionJson}
        )
      `;
    }

    const projectionPipeline = yield* OrchestrationProjectionPipeline;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const allTimings: Array<number> = [];
    const assistantStreamingTimings: Array<number> = [];
    const otherTimings: Array<number> = [];
    const timingsByBucket = new Map<string, Array<number>>();
    const startedAt = performance.now();

    for (const [index, event] of sourceEvents.entries()) {
      const eventStartedAt = performance.now();
      yield* projectionPipeline.projectEvent(event);
      const elapsedMs = performance.now() - eventStartedAt;
      allTimings.push(elapsedMs);
      const bucket = eventTimingBucket(event);
      const bucketTimings = timingsByBucket.get(bucket);
      if (bucketTimings === undefined) {
        timingsByBucket.set(bucket, [elapsedMs]);
      } else {
        bucketTimings.push(elapsedMs);
      }
      if (classifyReplayEvent(event) === "assistant-streaming-message") {
        assistantStreamingTimings.push(elapsedMs);
      } else {
        otherTimings.push(elapsedMs);
      }
      const replayed = index + 1;
      if (replayed % options.progressEvery === 0 || replayed === sourceEvents.length) {
        const stats = calculateTimingStats(allTimings.slice(-options.progressEvery));
        console.log(
          `progress ${replayed}/${sourceEvents.length}: recent_mean=${formatMs(
            stats.meanMs,
          )}ms recent_p50=${formatMs(stats.p50Ms)}ms recent_p90=${formatMs(
            stats.p90Ms,
          )}ms recent_p99=${formatMs(stats.p99Ms)}ms`,
        );
      }
    }

    const totalWallMs = performance.now() - startedAt;
    const detail = yield* projectionSnapshotQuery.getThreadDetailById(
      ThreadId.make(options.threadId),
    );
    if (Option.isNone(detail)) {
      throw new Error("Replay completed but thread detail was not projected");
    }

    const targetChecksums: Record<string, string> = {};
    const sourceChecksums: Record<string, string> = {};
    const tablesToVerify = options.limit === null ? verifyTablesForMode(options.verify) : [];
    if (tablesToVerify.length > 0) {
      for (const table of tablesToVerify) {
        const rows = yield* readTargetChecksumRows(sql, table, options.threadId);
        targetChecksums[table] = checksumRows(rows);
      }

      for (const table of tablesToVerify) {
        sourceChecksums[table] = checksumRows(
          readSourceChecksumRows(options.sourceDb, table, options.threadId),
        );
      }
    }

    return {
      sourceEvents,
      allTimings,
      assistantStreamingTimings,
      otherTimings,
      timingsByBucket,
      totalWallMs,
      sourceChecksums,
      targetChecksums,
      detail: detail.value,
    };
  }).pipe(Effect.provide(makeTargetLayer(options, targetFile)));

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.compare === "assistant-streaming") {
    runAssistantStreamingCompare(options);
    return;
  }

  if (options.diffOnly) {
    const sourceEvents = readSourceEvents(options.sourceDb, options.threadId).slice(
      0,
      options.limit ?? undefined,
    );
    const sourceRows = readSourceMessageRows(options.sourceDb, options.threadId);
    const expectedRows = deriveMessageRowsFromEvents(sourceEvents);
    const diffs = buildMessageDiffs({
      sourceRows,
      expectedRows,
      limit: options.diffMessages > 0 ? options.diffMessages : 20,
    });
    console.log(`thread=${options.threadId}`);
    console.log(`sourceDb=${options.sourceDb}`);
    console.log(`mode=diff-only`);
    console.log(`events=${sourceEvents.length}`);
    console.log(`sourceMessages=${sourceRows.length}`);
    console.log(`eventDerivedMessages=${expectedRows.length}`);
    console.log(`message_diffs=${diffs.length}`);
    for (const diff of diffs) {
      console.log(`  ${JSON.stringify(diff)}`);
    }
    return;
  }

  const targetFile =
    options.target === "file"
      ? resolve(options.targetFile ?? makeDefaultTargetFile(options.threadId))
      : null;
  if (targetFile !== null && existsSync(targetFile)) {
    rmSync(targetFile, { force: true });
  }

  const result = Effect.runPromise(
    runReplay(options, targetFile).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(`Replay benchmark failed: ${String(cause)}`),
      ),
    ),
  );
  result
    .then((replay) => {
      console.log(`thread=${options.threadId}`);
      console.log(`sourceDb=${options.sourceDb}`);
      console.log(`target=${options.target}${targetFile ? `:${targetFile}` : ""}`);
      console.log(`events=${replay.sourceEvents.length}`);
      console.log(`messages=${replay.detail.messages.length}`);
      console.log(`activities=${replay.detail.activities.length}`);
      console.log(`wall=${formatMs(replay.totalWallMs)}ms`);
      printStats("all", replay.allTimings);
      printStats("assistant_streaming", replay.assistantStreamingTimings);
      printStats("other", replay.otherTimings);
      console.log("event_type_buckets:");
      const sortedBuckets = [...replay.timingsByBucket.entries()].toSorted(
        ([, left], [, right]) => right.length - left.length,
      );
      for (const [bucket, timings] of sortedBuckets) {
        printStats(`  ${bucket}`, timings);
      }

      console.log("samples:");
      for (const sample of buildTimingSamples(replay.allTimings, options.sampleEvery)) {
        console.log(
          `  ${sample.fromEvent}-${sample.toEvent}: mean=${formatMs(
            sample.stats.meanMs,
          )}ms p50=${formatMs(sample.stats.p50Ms)}ms p90=${formatMs(
            sample.stats.p90Ms,
          )}ms p99=${formatMs(sample.stats.p99Ms)}ms max=${formatMs(sample.stats.maxMs)}ms`,
        );
      }

      const tablesToVerify = options.limit === null ? verifyTablesForMode(options.verify) : [];
      if (tablesToVerify.length > 0) {
        console.log(`checksums (${options.verify}):`);
        let mismatchCount = 0;
        for (const table of tablesToVerify) {
          const source = replay.sourceChecksums[table];
          const target = replay.targetChecksums[table];
          const ok = source === target;
          if (!ok) {
            mismatchCount += 1;
          }
          console.log(`  ${table}: ${ok ? "ok" : "mismatch"}`);
        }
        if (mismatchCount > 0) {
          process.exitCode = 1;
        }
      } else if (options.verify === "none") {
        console.log("checksums: skipped by --verify none");
      } else {
        console.log("checksums: skipped for limited replay");
      }
      if (options.diffMessages > 0) {
        const sourceRows = readSourceMessageRows(options.sourceDb, options.threadId);
        const expectedRows = deriveMessageRowsFromEvents(replay.sourceEvents);
        const diffs = buildMessageDiffs({
          sourceRows,
          expectedRows,
          limit: options.diffMessages,
        });
        console.log(`message_diffs: ${diffs.length}`);
        for (const diff of diffs) {
          console.log(`  ${JSON.stringify(diff)}`);
        }
      }
      if (targetFile !== null && !options.keepTarget) {
        rmSync(targetFile, { force: true });
        rmSync(`${targetFile}-shm`, { force: true });
        rmSync(`${targetFile}-wal`, { force: true });
      }
    })
    .catch((cause: unknown) => {
      console.error(cause);
      process.exitCode = 1;
    });
}

if (import.meta.main) {
  main();
}
