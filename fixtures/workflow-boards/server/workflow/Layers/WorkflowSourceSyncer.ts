import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { effectiveAutoPullRule } from "../../../contracts/workSource.ts";
import type { BoardId, LaneKey, WorkflowSourceConfig } from "../../../contracts/workflow.ts";
import { BoardRegistry } from "../Services/BoardRegistry.ts";
import { PredicateEvaluator } from "../Services/PredicateEvaluator.ts";
import { WorkflowEngine } from "../Services/WorkflowEngine.ts";
import {
  WorkSourceProviderRegistry,
  WorkSourceRateLimitError,
  type WorkSourceProvider,
  type WorkSourceProviderError,
} from "../Services/WorkSourceProvider.ts";
import {
  scanSource,
  chunkArray,
  describeWorkSourceProviderError,
  MAX_DELTAS_PER_RECONCILE_CHUNK,
} from "../scanSource.ts";
export { MAX_DELTAS_PER_RECONCILE_CHUNK } from "../scanSource.ts";
import { WorkflowSourceCommitter, type SourceDelta } from "../Services/WorkflowSourceCommitter.ts";
import {
  WorkflowSourceSyncer,
  type WorkflowSourceSyncerShape,
} from "../Services/WorkflowSourceSyncer.ts";
import { classifyDeltas, type MappingRow } from "../sourceReconcileDiff.ts";
import { gateNewDeltas } from "../sourceAutoPull.ts";

export const DEFAULT_SYNC_INTERVAL_SEC = 120;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 3_600_000;

const isRateLimitError = Schema.is(WorkSourceRateLimitError);

interface SourceStateRow {
  readonly backoffUntil: string | null;
  readonly consecutiveFailures: number;
  readonly lastFullRunAt: string | null;
}

interface MappingSelectRow {
  readonly externalId: string;
  readonly ticketId: string;
  readonly contentHash: string;
  readonly providerVersion: string | null;
  readonly lifecycle: string;
  readonly syncStatus: string;
  readonly sourceMetadataJson: string | null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const registry = yield* WorkSourceProviderRegistry;
  const committer = yield* WorkflowSourceCommitter;
  const engine = yield* WorkflowEngine;
  const boards = yield* BoardRegistry;
  const predicates = yield* PredicateEvaluator;

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const readState = (boardId: BoardId, sourceId: string) =>
    sql<SourceStateRow>`
      SELECT backoff_until AS "backoffUntil",
             consecutive_failures AS "consecutiveFailures",
             last_full_run_at AS "lastFullRunAt"
      FROM p_workflow_boards_work_source_state
      WHERE board_id = ${String(boardId)} AND source_id = ${sourceId}
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const ensureStateRow = (boardId: BoardId, sourceId: string) =>
    sql`
      INSERT INTO p_workflow_boards_work_source_state (board_id, source_id, consecutive_failures)
      VALUES (${String(boardId)}, ${sourceId}, 0)
      ON CONFLICT (board_id, source_id) DO NOTHING
    `;

  const readMappings = (boardId: BoardId, sourceId: string) =>
    sql<MappingSelectRow>`
      SELECT external_id AS "externalId",
             ticket_id AS "ticketId",
             content_hash AS "contentHash",
             provider_version AS "providerVersion",
             lifecycle AS "lifecycle",
             sync_status AS "syncStatus",
             source_metadata_json AS "sourceMetadataJson"
      FROM p_workflow_boards_work_source_mapping
      WHERE board_id = ${String(boardId)} AND source_id = ${sourceId}
    `.pipe(
      Effect.map((rows) =>
        rows.map(
          (row): MappingRow => ({
            externalId: row.externalId,
            ticketId: row.ticketId,
            contentHash: row.contentHash,
            providerVersion: row.providerVersion,
            lifecycle: row.lifecycle,
            syncStatus: row.syncStatus,
            sourceMetadataJson: row.sourceMetadataJson,
          }),
        ),
      ),
    );

  const resolveMissing = (
    provider: WorkSourceProvider,
    source: WorkflowSourceConfig,
    deltas: ReadonlyArray<SourceDelta>,
  ): Effect.Effect<ReadonlyArray<SourceDelta>, WorkSourceProviderError> =>
    Effect.forEach(deltas, (delta) => {
      if (delta._tag !== "missing") {
        return Effect.succeed(delta);
      }
      return provider
        .getItem({
          connectionRef: source.connectionRef,
          selector: source.selector,
          externalId: delta.item.externalId,
        })
        .pipe(
          Effect.map(
            (item): SourceDelta => ({
              ...delta,
              confirmedDeleted: item === null,
            }),
          ),
        );
    });

  const recordSuccess = (boardId: BoardId, sourceId: string) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      yield* sql`
        UPDATE p_workflow_boards_work_source_state
        SET consecutive_failures = 0,
            backoff_until = NULL,
            last_error = NULL,
            last_full_run_at = ${now}
        WHERE board_id = ${String(boardId)} AND source_id = ${sourceId}
      `;
    });

  const recordFailure = (
    boardId: BoardId,
    sourceId: string,
    priorFailures: number,
    error: WorkSourceProviderError,
  ) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const isRateLimit = isRateLimitError(error);
      const delayMs = isRateLimit
        ? error.retryAfterMs
        : Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** priorFailures);
      const backoffUntil = DateTime.formatIso(DateTime.addDuration(now, Duration.millis(delayMs)));
      const message = isRateLimit
        ? `rate-limited (retryAfterMs=${error.retryAfterMs})`
        : describeWorkSourceProviderError(error);
      yield* sql`
        UPDATE p_workflow_boards_work_source_state
        SET consecutive_failures = consecutive_failures + 1,
            backoff_until = ${backoffUntil},
            last_error = ${message}
        WHERE board_id = ${String(boardId)} AND source_id = ${sourceId}
      `;
    });

  const processSource = (boardId: BoardId, source: WorkflowSourceConfig) =>
    Effect.gen(function* () {
      yield* ensureStateRow(boardId, source.id);
      const state = yield* readState(boardId, source.id);

      if (state?.backoffUntil != null) {
        const until = DateTime.makeUnsafe(state.backoffUntil);
        if (DateTime.isFutureUnsafe(until)) {
          return;
        }
      }

      if (state?.lastFullRunAt != null) {
        const effectiveIntervalSec = source.syncIntervalSec ?? DEFAULT_SYNC_INTERVAL_SEC;
        const dueAt = DateTime.addDuration(
          DateTime.makeUnsafe(state.lastFullRunAt),
          Duration.seconds(effectiveIntervalSec),
        );
        if (DateTime.isFutureUnsafe(dueAt)) {
          return;
        }
      }

      const provider = registry.get(source.provider);
      const priorFailures = state?.consecutiveFailures ?? 0;
      const mappings = yield* readMappings(boardId, source.id);

      if (effectiveAutoPullRule(source) === null && mappings.length === 0) {
        yield* recordSuccess(boardId, source.id);
        return;
      }

      const outcome = yield* scanSource(provider, source, undefined).pipe(
        Effect.flatMap((scanned) =>
          Effect.gen(function* () {
            const deltas = classifyDeltas({
              sourceId: source.id,
              provider: source.provider,
              items: scanned.items,
              mappings,
              scanCompleted: scanned.scanCompleted,
            });
            const gated = yield* gateNewDeltas(deltas, effectiveAutoPullRule(source), predicates);
            const resolved = yield* resolveMissing(provider, source, gated);
            return { resolved, scanCompleted: scanned.scanCompleted };
          }),
        ),
        Effect.result,
      );

      if (outcome._tag === "Failure") {
        yield* recordFailure(boardId, source.id, priorFailures, outcome.failure);
        return;
      }

      const { resolved } = outcome.success;
      for (const chunk of chunkArray(resolved, MAX_DELTAS_PER_RECONCILE_CHUNK)) {
        yield* committer.reconcileChunk(
          boardId,
          {
            destinationLane: source.destinationLane as LaneKey,
            closedLane: source.closedLane as LaneKey,
          },
          chunk,
        );
      }
      yield* recordSuccess(boardId, source.id);
    });

  const sweep: WorkflowSourceSyncerShape["sweep"] = Effect.gen(function* () {
    const definitions = yield* boards
      .listDefinitions()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("workflow.source-syncer.list-boards-failed", { cause }).pipe(
            Effect.as([] as ReadonlyArray<{ readonly boardId: BoardId }>),
          ),
        ),
      );

    for (const { boardId, definition } of definitions as ReadonlyArray<{
      readonly boardId: BoardId;
      readonly definition: { readonly sources?: ReadonlyArray<WorkflowSourceConfig> };
    }>) {
      const sources = definition.sources ?? [];
      for (const source of sources) {
        yield* processSource(boardId, source).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("workflow.source-syncer.source-failed", {
              boardId,
              sourceId: source.id,
              cause,
            }),
          ),
        );
      }

      yield* engine
        .recoverBoardWip(boardId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("workflow.source-syncer.recover-wip-failed", { boardId, cause }),
          ),
        );
    }
  });

  const start: WorkflowSourceSyncerShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        sweep.pipe(
          Effect.catchDefect((defect: unknown) =>
            Effect.logWarning("workflow.source-syncer.sweep-defect", { defect }),
          ),
          Effect.repeat(Schedule.spaced(Duration.seconds(DEFAULT_SYNC_INTERVAL_SEC))),
        ),
      );
      yield* Effect.logInfo("workflow.source-syncer.started", {
        intervalSec: DEFAULT_SYNC_INTERVAL_SEC,
      });
    });

  return { sweep, start } satisfies WorkflowSourceSyncerShape;
});

export const WorkflowSourceSyncerLive = Layer.effect(WorkflowSourceSyncer, make);
