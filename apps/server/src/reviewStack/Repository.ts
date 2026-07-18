import {
  ModelSelection,
  ReviewStackAnchor,
  ReviewStackDocument,
  ReviewStackError,
  ReviewStackSnapshot,
  ReviewStackSnapshotId,
  ReviewStackSnapshotMetadata,
  ReviewStackTarget,
  type ReviewStackStage,
  type ReviewStackStatus,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

interface SnapshotRow {
  snapshotId: string;
  threadId: string;
  scopeKey: string;
  scopeJson: string;
  sourceHash: string;
  sourceDiff: string;
  anchorCatalogJson: string;
  sourceTruncated: number;
  status: string;
  stage: string;
  modelSelectionJson: string;
  instructions: string;
  reviewJson: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface InsertSnapshotInput {
  snapshotId: ReviewStackSnapshotId;
  threadId: ThreadId;
  scopeKey: string;
  target: ReviewStackTarget;
  sourceHash: string;
  sourceDiff: string;
  anchorCatalog: ReadonlyArray<ReviewStackAnchor>;
  sourceTruncated: boolean;
  modelSelection: ModelSelection;
  instructions: string;
  createdAt: string;
}

export interface UpdateSnapshotInput {
  snapshotId: ReviewStackSnapshotId;
  status: ReviewStackStatus;
  stage: ReviewStackStage;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  review?: ReviewStackDocument | null;
  errorMessage?: string | null;
}

export class ReviewStackRepository extends Context.Service<
  ReviewStackRepository,
  {
    readonly insert: (input: InsertSnapshotInput) => Effect.Effect<void, ReviewStackError>;
    readonly get: (
      threadId: ThreadId,
      snapshotId: ReviewStackSnapshotId,
    ) => Effect.Effect<ReviewStackSnapshot | null, ReviewStackError>;
    readonly list: (
      threadId: ThreadId,
      scopeKey: string,
    ) => Effect.Effect<ReadonlyArray<ReviewStackSnapshotMetadata>, ReviewStackError>;
    readonly findReusable: (
      threadId: ThreadId,
      scopeKey: string,
      sourceHash: string,
    ) => Effect.Effect<ReviewStackSnapshot | null, ReviewStackError>;
    readonly update: (input: UpdateSnapshotInput) => Effect.Effect<void, ReviewStackError>;
    readonly listRecoverable: Effect.Effect<ReadonlyArray<ReviewStackSnapshot>, ReviewStackError>;
  }
>()("t3/reviewStack/Repository/ReviewStackRepository") {}

function failure(operation: string, cause: unknown): ReviewStackError {
  return new ReviewStackError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

const TargetJson = Schema.fromJsonString(ReviewStackTarget);
const AnchorCatalogJson = Schema.fromJsonString(Schema.Array(ReviewStackAnchor));
const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const DocumentJson = Schema.fromJsonString(ReviewStackDocument);
const decodeTargetJson = Schema.decodeUnknownEffect(TargetJson);
const decodeAnchorCatalogJson = Schema.decodeUnknownEffect(AnchorCatalogJson);
const decodeModelSelectionJson = Schema.decodeUnknownEffect(ModelSelectionJson);
const decodeDocumentJson = Schema.decodeUnknownEffect(DocumentJson);
const decodeSnapshotValue = Schema.decodeUnknownEffect(ReviewStackSnapshot);
const encodeTargetJson = Schema.encodeSync(TargetJson);
const encodeAnchorCatalogJson = Schema.encodeSync(AnchorCatalogJson);
const encodeModelSelectionJson = Schema.encodeSync(ModelSelectionJson);
const encodeDocumentJson = Schema.encodeSync(DocumentJson);

const decodeSnapshot = Effect.fn("ReviewStackRepository.decodeSnapshot")(
  function* (row: SnapshotRow) {
    const target = yield* decodeTargetJson(row.scopeJson);
    const anchorCatalog = yield* decodeAnchorCatalogJson(row.anchorCatalogJson);
    const modelSelection = yield* decodeModelSelectionJson(row.modelSelectionJson);
    const review = row.reviewJson === null ? null : yield* decodeDocumentJson(row.reviewJson);
    return yield* decodeSnapshotValue({
      metadata: {
        snapshotId: row.snapshotId,
        threadId: row.threadId,
        target,
        scopeKey: row.scopeKey,
        sourceHash: row.sourceHash,
        sourceTruncated: row.sourceTruncated !== 0,
        status: row.status,
        stage: row.stage,
        modelSelection,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
      },
      sourceDiff: row.sourceDiff,
      anchorCatalog,
      instructions: row.instructions,
      review,
    }).pipe(Effect.mapError((cause) => failure("decode", cause)));
  },
  Effect.mapError((cause) => failure("decode", cause)),
);

const selectColumns = `
  snapshot_id AS "snapshotId", thread_id AS "threadId", scope_key AS "scopeKey",
  scope_json AS "scopeJson", source_hash AS "sourceHash", source_diff AS "sourceDiff",
  anchor_catalog_json AS "anchorCatalogJson", source_truncated AS "sourceTruncated",
  status, stage, model_selection_json AS "modelSelectionJson", instructions,
  review_json AS "reviewJson", error_message AS "errorMessage", created_at AS "createdAt",
  started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt"
`;

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const run = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => failure(operation, cause)));

  const insert: ReviewStackRepository["Service"]["insert"] = (input) =>
    run(
      "insert",
      sql`
      INSERT INTO review_stack_snapshots (
        snapshot_id, thread_id, scope_key, scope_json, source_hash, source_diff,
        anchor_catalog_json, source_truncated, status, stage, model_selection_json,
        instructions, created_at, updated_at
      ) VALUES (
        ${input.snapshotId}, ${input.threadId}, ${input.scopeKey}, ${encodeTargetJson(input.target)},
        ${input.sourceHash}, ${input.sourceDiff}, ${encodeAnchorCatalogJson(input.anchorCatalog)},
        ${input.sourceTruncated ? 1 : 0}, 'queued', 'queued',
        ${encodeModelSelectionJson(input.modelSelection)}, ${input.instructions}, ${input.createdAt},
        ${input.createdAt}
      )
    `,
    ).pipe(Effect.asVoid);

  const get: ReviewStackRepository["Service"]["get"] = (threadId, snapshotId) =>
    run(
      "get",
      sql.unsafe<SnapshotRow>(
        `SELECT ${selectColumns} FROM review_stack_snapshots WHERE thread_id = ? AND snapshot_id = ? LIMIT 1`,
        [threadId, snapshotId],
      ),
    ).pipe(Effect.flatMap((rows) => (rows[0] ? decodeSnapshot(rows[0]) : Effect.succeed(null))));

  const list: ReviewStackRepository["Service"]["list"] = (threadId, scopeKey) =>
    run(
      "list",
      sql.unsafe<SnapshotRow>(
        `SELECT ${selectColumns} FROM review_stack_snapshots WHERE thread_id = ? AND scope_key = ? ORDER BY created_at DESC, snapshot_id DESC`,
        [threadId, scopeKey],
      ),
    ).pipe(
      Effect.flatMap((rows) => Effect.all(rows.map(decodeSnapshot))),
      Effect.map((snapshots) => snapshots.map((snapshot) => snapshot.metadata)),
    );

  const findReusable: ReviewStackRepository["Service"]["findReusable"] = (
    threadId,
    scopeKey,
    sourceHash,
  ) =>
    run(
      "findReusable",
      sql.unsafe<SnapshotRow>(
        `SELECT ${selectColumns} FROM review_stack_snapshots
         WHERE thread_id = ? AND scope_key = ? AND source_hash = ?
           AND status IN ('queued', 'running', 'completed')
         ORDER BY created_at DESC, snapshot_id DESC LIMIT 1`,
        [threadId, scopeKey, sourceHash],
      ),
    ).pipe(Effect.flatMap((rows) => (rows[0] ? decodeSnapshot(rows[0]) : Effect.succeed(null))));

  const update: ReviewStackRepository["Service"]["update"] = (input) =>
    run(
      "update",
      sql`
      UPDATE review_stack_snapshots SET
        status = ${input.status}, stage = ${input.stage}, updated_at = ${input.updatedAt},
        started_at = COALESCE(${input.startedAt ?? null}, started_at),
        completed_at = COALESCE(${input.completedAt ?? null}, completed_at),
        review_json = COALESCE(${input.review === undefined ? null : input.review === null ? null : encodeDocumentJson(input.review)}, review_json),
        error_message = ${input.errorMessage ?? null}
      WHERE snapshot_id = ${input.snapshotId}
    `,
    ).pipe(Effect.asVoid);

  const listRecoverable = run(
    "listRecoverable",
    sql.unsafe<SnapshotRow>(
      `SELECT ${selectColumns} FROM review_stack_snapshots WHERE status IN ('queued', 'running') ORDER BY created_at ASC`,
    ),
  ).pipe(Effect.flatMap((rows) => Effect.all(rows.map(decodeSnapshot))));

  return ReviewStackRepository.of({ insert, get, list, findReusable, update, listRecoverable });
});

export const layer = Layer.effect(ReviewStackRepository, make);
