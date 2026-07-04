import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { BoardId, LaneKey, WorkflowDefinition } from "../../../contracts/workflow.ts";
import { MigrationsLive } from "../../persistence/Migrations.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { BoardRegistry, type BoardRegistryShape } from "../Services/BoardRegistry.ts";
import { WorkflowEngine, type WorkflowEngineShape } from "../Services/WorkflowEngine.ts";
import {
  WorkSourceProviderRegistry,
  type ExternalWorkItem,
  type WorkSourceProvider,
} from "../Services/WorkSourceProvider.ts";
import {
  WorkflowSourceCommitter,
  type ReconcileLanes,
  type SourceDelta,
} from "../Services/WorkflowSourceCommitter.ts";
import { WorkflowSourceSyncer } from "../Services/WorkflowSourceSyncer.ts";
import { PredicateEvaluatorLive } from "./PredicateEvaluator.ts";
import { WorkflowSourceSyncerLive } from "./WorkflowSourceSyncer.ts";

const boardId = "board-sync" as BoardId;
const sourceId = "github-main";

const externalItem = (externalId: string, labels: ReadonlyArray<string>): ExternalWorkItem => ({
  provider: "github",
  externalId,
  url: `https://github.com/acme/sprockets/issues/${externalId}`,
  lifecycle: "open",
  version: { updatedAt: "2026-07-03T00:00:00.000Z" },
  fields: {
    title: `Issue ${externalId}`,
    description: `Body ${externalId}`,
    labels,
  },
});

const definition = {
  name: "Source sync test",
  lanes: [
    { key: "todo", name: "Todo", entry: "manual" },
    { key: "done", name: "Done", entry: "manual", terminal: true },
  ],
  sources: [
    {
      id: sourceId,
      provider: "github",
      connectionRef: "conn-1",
      selector: { owner: "acme", repo: "sprockets", state: "all" },
      destinationLane: "todo",
      closedLane: "done",
      enabled: false,
      autoPull: { rule: { in: ["sync", { var: "labels" }] } },
    },
  ],
} as unknown as WorkflowDefinition;

const boardRegistry = Layer.succeed(BoardRegistry, {
  register: () => Effect.succeed(definition),
  unregister: () => Effect.void,
  getDefinition: (id) => Effect.succeed(id === boardId ? definition : null),
  listDefinitions: () => Effect.succeed([{ boardId, definition }]),
  getLane: (_id, laneKey) =>
    Effect.succeed(definition.lanes.find((lane) => lane.key === laneKey) ?? null),
} satisfies BoardRegistryShape);

const provider: WorkSourceProvider = {
  provider: "github",
  selectorSchema: Schema.Unknown,
  listPage: () =>
    Effect.succeed({
      items: [externalItem("42", ["sync", "bug"]), externalItem("99", ["skip"])],
    }),
  getItem: () => Effect.die("getItem should not be called for new-only syncer test"),
  viewer: () => Effect.succeed(null),
  toImportableView: () => ({ displayRef: "", container: "" }),
};

const providerRegistry = Layer.succeed(WorkSourceProviderRegistry, {
  get: () => provider,
});

const committerLayer = (
  chunks: Ref.Ref<
    Array<{
      readonly boardId: BoardId;
      readonly lanes: ReconcileLanes;
      readonly deltas: SourceDelta[];
    }>
  >,
) =>
  Layer.succeed(WorkflowSourceCommitter, {
    reconcileChunk: (id, lanes, deltas) =>
      Ref.update(chunks, (current) => [...current, { boardId: id, lanes, deltas: [...deltas] }]),
  } satisfies WorkflowSourceCommitter["Service"]);

const engineLayer = (recoveries: Ref.Ref<BoardId[]>) =>
  Layer.succeed(WorkflowEngine, {
    recoverBoardWip: (id: BoardId) => Ref.update(recoveries, (current) => [...current, id]),
  } as unknown as WorkflowEngineShape);

const testLayer = (
  chunks: Ref.Ref<
    Array<{
      readonly boardId: BoardId;
      readonly lanes: ReconcileLanes;
      readonly deltas: SourceDelta[];
    }>
  >,
  recoveries: Ref.Ref<BoardId[]>,
) =>
  WorkflowSourceSyncerLive.pipe(
    Layer.provide(boardRegistry),
    Layer.provide(providerRegistry),
    Layer.provide(committerLayer(chunks)),
    Layer.provide(engineLayer(recoveries)),
    Layer.provide(PredicateEvaluatorLive),
    Layer.provideMerge(MigrationsLive),
    Layer.provideMerge(SqlitePersistenceMemory),
  );

it.effect(
  "sweep classifies provider items, gates new deltas, and reconciles matching imports",
  () =>
    Effect.gen(function* () {
      const chunks = yield* Ref.make<
        Array<{
          readonly boardId: BoardId;
          readonly lanes: ReconcileLanes;
          readonly deltas: SourceDelta[];
        }>
      >([]);
      const recoveries = yield* Ref.make<BoardId[]>([]);

      yield* Effect.gen(function* () {
        const syncer = yield* WorkflowSourceSyncer;
        yield* syncer.sweep;

        const recorded = yield* Ref.get(chunks);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0]?.boardId, boardId);
        assert.deepEqual(recorded[0]?.lanes, {
          destinationLane: "todo" as LaneKey,
          closedLane: "done" as LaneKey,
        });
        assert.equal(recorded[0]?.deltas.length, 1);
        assert.equal(recorded[0]?.deltas[0]?._tag, "new");
        assert.equal(recorded[0]?.deltas[0]?.item.externalId, "42");

        const recovered = yield* Ref.get(recoveries);
        assert.deepEqual(recovered, [boardId]);

        const sql = yield* SqlClient.SqlClient;
        const stateRows = yield* sql<{
          readonly consecutiveFailures: number;
          readonly backoffUntil: string | null;
          readonly lastFullRunAt: string | null;
        }>`
        SELECT consecutive_failures AS "consecutiveFailures",
               backoff_until AS "backoffUntil",
               last_full_run_at AS "lastFullRunAt"
        FROM p_workflow_boards_work_source_state
        WHERE board_id = ${String(boardId)} AND source_id = ${sourceId}
      `;
        assert.equal(stateRows[0]?.consecutiveFailures, 0);
        assert.equal(stateRows[0]?.backoffUntil, null);
        assert.isString(stateRows[0]?.lastFullRunAt);
      }).pipe(Effect.provide(testLayer(chunks, recoveries)));
    }),
);
