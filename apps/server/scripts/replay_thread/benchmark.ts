import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { Database } from "bun:sqlite";

import { calculateTimingStats } from "./core.ts";

interface CliOptions {
  readonly sourceDb: string;
  readonly threadId: string;
  readonly windowSize: number;
  readonly legacyMode: "sampled" | "full";
  readonly legacySamplePerWindow: number;
  readonly limit: number | null;
}

interface SourceEventRow {
  readonly sequence: number;
  readonly payloadJson: string;
}

interface AssistantStreamingEvent {
  readonly sequence: number;
  readonly messageId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly role: "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SourceThreadRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly modelSelectionJson: string | null;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly latestTurnId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly latestUserMessageAt: string | null;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly hasActionableProposedPlan: number;
  readonly deletedAt: string | null;
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

interface SourceActivityRow {
  readonly activityId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly tone: string;
  readonly kind: string;
  readonly summary: string;
  readonly payloadJson: string;
  readonly sequence: number | null;
  readonly createdAt: string;
}

interface SourcePlanRow {
  readonly planId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly planMarkdown: string;
  readonly implementedAt: string | null;
  readonly implementationThreadId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SourceApprovalRow {
  readonly approvalId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type SqlBindingRecord = Record<string, string | number | bigint | boolean | Uint8Array | null>;

let _summaryRefreshSink = "";

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let sourceDb: string | undefined;
  let threadId: string | undefined;
  let windowSize = 10_000;
  let legacyMode: CliOptions["legacyMode"] = "sampled";
  let legacySamplePerWindow = 500;
  let limit: number | null = null;

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
      case "--window-size":
        windowSize = Number(next());
        break;
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
      case "--limit":
        limit = Number(next());
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
  if (!Number.isFinite(windowSize) || windowSize < 1) {
    throw new Error("--window-size must be a positive number");
  }
  if (!Number.isFinite(legacySamplePerWindow) || legacySamplePerWindow < 1) {
    throw new Error("--legacy-sample-per-window must be a positive number");
  }
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("--limit must be a positive number");
  }

  return {
    sourceDb,
    threadId,
    windowSize,
    legacyMode,
    legacySamplePerWindow,
    limit,
  };
}

function printUsage() {
  console.log(`Usage:
  bun apps/server/scripts/replay_thread/benchmark.ts \\
    --source-db C:\\Users\\mike\\.t3\\dev\\state.sqlite \\
    --thread-id de1c398f-5d3c-40e4-911c-2b672653cda7 \\
    --window-size 10000 \\
    --legacy-sample-per-window 500

Options:
  --source-db <path>                 SQLite DB containing the copied production thread
  --thread-id <id>                   Thread to benchmark
  --window-size <n>                  Assistant-streaming events per output window (default: 10000)
  --legacy-mode sampled|full         Sample old path per window, or run every event (default: sampled)
  --legacy-sample-per-window <n>     Old-path samples per window in sampled mode (default: 500)
  --limit <n>                        Optional cap for smoke runs
`);
}

function openSourceDb(path: string): Database {
  if (!existsSync(path)) {
    throw new Error(`Source DB does not exist: ${path}`);
  }
  return new Database(path, { readonly: true, strict: true });
}

function readAssistantStreamingEvents(
  db: Database,
  options: CliOptions,
): ReadonlyArray<AssistantStreamingEvent> {
  const rows = db
    .query<SourceEventRow, [string]>(
      `
        SELECT sequence, payload_json AS payloadJson
        FROM orchestration_events
        WHERE stream_id = ? AND event_type = 'thread.message-sent'
        ORDER BY sequence ASC
      `,
    )
    .all(options.threadId);

  const events: Array<AssistantStreamingEvent> = [];
  for (const row of rows) {
    const payload = JSON.parse(row.payloadJson) as Partial<AssistantStreamingEvent> & {
      readonly streaming?: unknown;
    };
    if (
      payload.threadId !== options.threadId ||
      payload.role !== "assistant" ||
      payload.streaming !== true ||
      typeof payload.messageId !== "string" ||
      typeof payload.text !== "string" ||
      typeof payload.createdAt !== "string" ||
      typeof payload.updatedAt !== "string"
    ) {
      continue;
    }
    events.push({
      sequence: row.sequence,
      messageId: payload.messageId,
      threadId: options.threadId,
      turnId: typeof payload.turnId === "string" ? payload.turnId : null,
      role: "assistant",
      text: payload.text,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    });
    if (options.limit !== null && events.length >= options.limit) {
      break;
    }
  }
  return events;
}

function createCompareDb(): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model_selection_json TEXT,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER NOT NULL DEFAULT 0,
      pending_user_input_count INTEGER NOT NULL DEFAULT 0,
      has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );

    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_messages_thread_created
      ON projection_thread_messages(thread_id, created_at, message_id);

    CREATE TABLE projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_activities_thread_sequence
      ON projection_thread_activities(thread_id, sequence, created_at, activity_id);

    CREATE TABLE projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      implemented_at TEXT,
      implementation_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE projection_pending_approvals (
      approval_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function readThread(db: Database, threadId: string): SourceThreadRow {
  const row = db
    .query<SourceThreadRow, [string]>(
      `
        SELECT
          thread_id AS threadId,
          project_id AS projectId,
          title,
          model_selection_json AS modelSelectionJson,
          runtime_mode AS runtimeMode,
          interaction_mode AS interactionMode,
          branch,
          worktree_path AS worktreePath,
          latest_turn_id AS latestTurnId,
          created_at AS createdAt,
          updated_at AS updatedAt,
          archived_at AS archivedAt,
          latest_user_message_at AS latestUserMessageAt,
          pending_approval_count AS pendingApprovalCount,
          pending_user_input_count AS pendingUserInputCount,
          has_actionable_proposed_plan AS hasActionableProposedPlan,
          deleted_at AS deletedAt
        FROM projection_threads
        WHERE thread_id = ?
      `,
    )
    .get(threadId);
  if (!row) {
    throw new Error(`Thread ${threadId} was not found in projection_threads`);
  }
  return row;
}

function seedThread(db: Database, thread: SourceThreadRow) {
  db.query(
    `
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
        latest_user_message_at, pending_approval_count, pending_user_input_count,
        has_actionable_proposed_plan, deleted_at
      )
      VALUES (
        $threadId, $projectId, $title, $modelSelectionJson, $runtimeMode, $interactionMode,
        $branch, $worktreePath, $latestTurnId, $createdAt, $updatedAt, $archivedAt,
        $latestUserMessageAt, $pendingApprovalCount, $pendingUserInputCount,
        $hasActionableProposedPlan, $deletedAt
      )
    `,
  ).run(thread as unknown as SqlBindingRecord);
}

function seedLegacyProjection(source: Database, target: Database, threadId: string) {
  seedThread(target, readThread(source, threadId));

  const messages = source
    .query<SourceMessageRow, [string]>(
      `
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
      `,
    )
    .all(threadId);
  const insertMessage = target.query(`
    INSERT INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, attachments_json, is_streaming, created_at, updated_at
    )
    VALUES (
      $messageId, $threadId, $turnId, $role, $text, $attachmentsJson, $isStreaming, $createdAt, $updatedAt
    )
  `);
  for (const message of messages) {
    insertMessage.run(message as unknown as SqlBindingRecord);
  }

  const activities = source
    .query<SourceActivityRow, [string]>(
      `
        SELECT
          activity_id AS activityId,
          thread_id AS threadId,
          turn_id AS turnId,
          tone,
          kind,
          summary,
          payload_json AS payloadJson,
          sequence,
          created_at AS createdAt
        FROM projection_thread_activities
        WHERE thread_id = ?
      `,
    )
    .all(threadId);
  const insertActivity = target.query(`
    INSERT INTO projection_thread_activities (
      activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
    )
    VALUES (
      $activityId, $threadId, $turnId, $tone, $kind, $summary, $payloadJson, $sequence, $createdAt
    )
  `);
  for (const activity of activities) {
    insertActivity.run(activity as unknown as SqlBindingRecord);
  }

  const plans = source
    .query<SourcePlanRow, [string]>(
      `
        SELECT
          plan_id AS planId,
          thread_id AS threadId,
          turn_id AS turnId,
          plan_markdown AS planMarkdown,
          implemented_at AS implementedAt,
          implementation_thread_id AS implementationThreadId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM projection_thread_proposed_plans
        WHERE thread_id = ?
      `,
    )
    .all(threadId);
  const insertPlan = target.query(`
    INSERT INTO projection_thread_proposed_plans (
      plan_id, thread_id, turn_id, plan_markdown, implemented_at, implementation_thread_id, created_at, updated_at
    )
    VALUES (
      $planId, $threadId, $turnId, $planMarkdown, $implementedAt, $implementationThreadId, $createdAt, $updatedAt
    )
  `);
  for (const plan of plans) {
    insertPlan.run(plan as unknown as SqlBindingRecord);
  }

  const approvals = source
    .query<SourceApprovalRow, [string]>(
      `
        SELECT
          request_id AS approvalId,
          thread_id AS threadId,
          turn_id AS turnId,
          status,
          created_at AS createdAt,
          COALESCE(resolved_at, created_at) AS updatedAt
        FROM projection_pending_approvals
        WHERE thread_id = ?
      `,
    )
    .all(threadId);
  const insertApproval = target.query(`
    INSERT INTO projection_pending_approvals (
      approval_id, thread_id, turn_id, status, created_at, updated_at
    )
    VALUES (
      $approvalId, $threadId, $turnId, $status, $createdAt, $updatedAt
    )
  `);
  for (const approval of approvals) {
    insertApproval.run(approval as unknown as SqlBindingRecord);
  }
}

function seedOptimizedProjection(source: Database, target: Database, threadId: string) {
  seedThread(target, readThread(source, threadId));
}

function makeOptimizedRunner(db: Database) {
  const append = db.query(`
    INSERT INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, attachments_json, is_streaming, created_at, updated_at
    )
    VALUES (
      $messageId, $threadId, $turnId, $role, $text, NULL, 1, $createdAt, $updatedAt
    )
    ON CONFLICT (message_id)
    DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = projection_thread_messages.text || excluded.text,
      is_streaming = excluded.is_streaming,
      updated_at = excluded.updated_at
  `);
  const touchThread = db.query(`
    UPDATE projection_threads
    SET updated_at = $updatedAt
    WHERE thread_id = $threadId
  `);

  return (event: AssistantStreamingEvent): number => {
    const started = performance.now();
    append.run({
      messageId: event.messageId,
      threadId: event.threadId,
      turnId: event.turnId,
      role: event.role,
      text: event.text,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
    touchThread.run({ threadId: event.threadId, updatedAt: event.updatedAt });
    return performance.now() - started;
  };
}

function makeLegacyRunner(db: Database) {
  const getExistingText = db.query<{ readonly text: string }, [string]>(
    `SELECT text FROM projection_thread_messages WHERE message_id = ?`,
  );
  const upsertFullText = db.query(`
    INSERT INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, attachments_json, is_streaming, created_at, updated_at
    )
    VALUES (
      $messageId, $threadId, $turnId, $role, $text, NULL, 1, $createdAt, $updatedAt
    )
    ON CONFLICT (message_id)
    DO UPDATE SET
      thread_id = excluded.thread_id,
      turn_id = excluded.turn_id,
      role = excluded.role,
      text = excluded.text,
      is_streaming = excluded.is_streaming,
      updated_at = excluded.updated_at
  `);
  const touchThread = db.query(`
    UPDATE projection_threads
    SET updated_at = $updatedAt
    WHERE thread_id = $threadId
  `);
  const listMessages = db.query(`
    SELECT message_id, role, text, attachments_json, is_streaming, created_at, updated_at
    FROM projection_thread_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC, message_id ASC
  `);
  const listActivities = db.query(`
    SELECT activity_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
    FROM projection_thread_activities
    WHERE thread_id = ?
    ORDER BY
      CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
      sequence ASC,
      created_at ASC,
      activity_id ASC
  `);
  const listPlans = db.query(`
    SELECT plan_id, turn_id, plan_markdown, implemented_at, implementation_thread_id, created_at, updated_at
    FROM projection_thread_proposed_plans
    WHERE thread_id = ?
    ORDER BY created_at ASC, plan_id ASC
  `);
  const pendingApprovals = db.query(`
    SELECT approval_id
    FROM projection_pending_approvals
    WHERE thread_id = ? AND status = 'pending'
  `);

  return (event: AssistantStreamingEvent): number => {
    const started = performance.now();
    db.exec("BEGIN");
    try {
      const existing = getExistingText.get(event.messageId);
      const nextText = `${existing?.text ?? ""}${event.text}`;
      upsertFullText.run({
        messageId: event.messageId,
        threadId: event.threadId,
        turnId: event.turnId,
        role: event.role,
        text: nextText,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      });
      touchThread.run({ threadId: event.threadId, updatedAt: event.updatedAt });

      // This mirrors the old per-delta shell summary refresh shape: hydrate the
      // thread's message/activity/plan/approval read-model state after every token.
      const messages = listMessages.all(event.threadId) as ReadonlyArray<{
        readonly role: string;
        readonly created_at: string;
      }>;
      const activities = listActivities.all(event.threadId) as ReadonlyArray<{
        readonly kind: string;
        readonly payload_json: string;
      }>;
      const plans = listPlans.all(event.threadId);
      const approvals = pendingApprovals.all(event.threadId);
      const latestUserMessageAt = messages
        .filter((message) => message.role === "user")
        .map((message) => message.created_at)
        .toSorted()
        .at(-1);
      const pendingUserInputCount = activities.filter((activity) => {
        if (activity.kind !== "input") {
          return false;
        }
        try {
          const payload = JSON.parse(activity.payload_json) as { readonly state?: string };
          return payload.state === "pending";
        } catch {
          return false;
        }
      }).length;
      const derivedSummary = {
        latestUserMessageAt,
        pendingUserInputCount,
        planCount: plans.length,
        pendingApprovalCount: approvals.length,
      };
      _summaryRefreshSink = JSON.stringify(derivedSummary);

      db.exec("ROLLBACK");
      return performance.now() - started;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}

function selectLegacyEvents(
  events: ReadonlyArray<AssistantStreamingEvent>,
  options: CliOptions,
): ReadonlyArray<AssistantStreamingEvent> {
  if (options.legacyMode === "full" || events.length <= options.legacySamplePerWindow) {
    return events;
  }

  const selected: Array<AssistantStreamingEvent> = [];
  const step = events.length / options.legacySamplePerWindow;
  for (let index = 0; index < options.legacySamplePerWindow; index += 1) {
    const event = events[Math.min(events.length - 1, Math.floor(index * step))];
    if (event) {
      selected.push(event);
    }
  }
  return selected;
}

function formatMs(value: number): string {
  return value.toFixed(4);
}

function divideForSpeedup(left: number, right: number): number {
  return right === 0 ? 0 : left / right;
}

function printCompareStats(input: {
  readonly label: string;
  readonly optimized: ReadonlyArray<number>;
  readonly legacy: ReadonlyArray<number>;
}) {
  const optimized = calculateTimingStats(input.optimized);
  const legacy = calculateTimingStats(input.legacy);
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
    `  speedup:   mean=${formatMs(divideForSpeedup(legacy.meanMs, optimized.meanMs))}x p50=${formatMs(
      divideForSpeedup(legacy.p50Ms, optimized.p50Ms),
    )}x p90=${formatMs(divideForSpeedup(legacy.p90Ms, optimized.p90Ms))}x p99=${formatMs(
      divideForSpeedup(legacy.p99Ms, optimized.p99Ms),
    )}x`,
  );
}

function runBenchmark(options: CliOptions) {
  const source = openSourceDb(options.sourceDb);
  const events = readAssistantStreamingEvents(source, options);
  if (events.length === 0) {
    throw new Error(`No assistant streaming events found for thread ${options.threadId}`);
  }

  const optimizedDb = createCompareDb();
  const legacyDb = createCompareDb();
  seedOptimizedProjection(source, optimizedDb, options.threadId);
  seedLegacyProjection(source, legacyDb, options.threadId);

  const runOptimized = makeOptimizedRunner(optimizedDb);
  const runLegacy = makeLegacyRunner(legacyDb);
  const optimizedTimings: Array<number> = [];
  const legacyTimings: Array<number> = [];
  const windows: Array<{
    readonly from: number;
    readonly to: number;
    readonly optimized: ReadonlyArray<number>;
    readonly legacy: ReadonlyArray<number>;
  }> = [];

  for (let start = 0; start < events.length; start += options.windowSize) {
    const end = Math.min(events.length, start + options.windowSize);
    const windowEvents = events.slice(start, end);
    const windowOptimized: Array<number> = [];
    const windowLegacy: Array<number> = [];

    for (const event of windowEvents) {
      const timing = runOptimized(event);
      windowOptimized.push(timing);
      optimizedTimings.push(timing);
    }

    for (const event of selectLegacyEvents(windowEvents, options)) {
      const timing = runLegacy(event);
      windowLegacy.push(timing);
      legacyTimings.push(timing);
    }

    windows.push({
      from: start + 1,
      to: end,
      optimized: windowOptimized,
      legacy: windowLegacy,
    });
    console.log(
      `compare progress ${end}/${events.length}: optimized=${windowOptimized.length} legacy=${windowLegacy.length}`,
    );
  }

  console.log(`thread=${options.threadId}`);
  console.log(`sourceDb=${options.sourceDb}`);
  console.log("mode=assistant-streaming");
  console.log(`legacyMode=${options.legacyMode}`);
  console.log(`windowSize=${options.windowSize}`);
  console.log(`assistantStreamingEvents=${events.length}`);
  if (options.legacyMode === "sampled") {
    console.log(`legacySamplePerWindow=${options.legacySamplePerWindow}`);
  }
  printCompareStats({
    label: "overall",
    optimized: optimizedTimings,
    legacy: legacyTimings,
  });
  for (const window of windows) {
    printCompareStats({
      label: `window ${window.from}-${window.to} optimizedEvents=${window.optimized.length} legacyEvents=${window.legacy.length}`,
      optimized: window.optimized,
      legacy: window.legacy,
    });
  }
}

try {
  runBenchmark(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
