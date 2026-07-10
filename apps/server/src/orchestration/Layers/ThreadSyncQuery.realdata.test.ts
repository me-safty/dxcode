import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationThreadV2StreamItem, ThreadId, type ThreadHead } from "@t3tools/contracts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { ThreadSyncQuery } from "../Services/ThreadSyncQuery.ts";
import { ThreadSyncQueryLive } from "./ThreadSyncQuery.ts";
import { buildSnapshotChunks } from "../ThreadSyncWire.ts";

// Diagnostic: replay REAL thread data (the disposable sandbox DB copy) through
// the exact cold-sync head composition subscribeThreadV2 emits, then apply the
// same wire round-trip and staging validations the mobile client performs.
// Purpose: find which validation trips on real-world data (on-device symptom:
// every thread hangs on "Loading messages..." with a silent resync no-op).
// Opt-in: point this at a copy of a real state.sqlite to replay production-scale
// threads through the v2 pipeline. Skipped entirely when unset (CI-safe).
const SANDBOX_DB = process.env.T3_THREAD_SYNC_REALDATA_DB;

const layer = it.layer(
  ThreadSyncQueryLive.pipe(
    Layer.provideMerge(makeSqlitePersistenceLive(SANDBOX_DB ?? ":memory:")),
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("ThreadSyncQuery real data", (it) => {
  const testIfConfigured = SANDBOX_DB === undefined ? it.effect.skip : it.effect;
  testIfConfigured(
    "cold-sync head for the busiest real threads survives wire round-trip and staging",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const query = yield* ThreadSyncQuery;

        // The busiest threads by activity count — the ones that hang on-device.
        const busiest = yield* sql`
          SELECT thread_id AS id, COUNT(*) AS n
          FROM projection_thread_activities
          GROUP BY thread_id ORDER BY n DESC LIMIT 5
        `;
        assert.isAbove(busiest.length, 0);

        for (const row of busiest) {
          const threadId = ThreadId.make(String(row.id));
          const tailOption = yield* query.getTail(threadId).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                assert.fail(`getTail(${threadId}) failed: ${String(error)}`);
              }),
            ),
          );
          if (Option.isNone(tailOption)) continue; // deleted thread
          const snapshot = tailOption.value;

          // Compose EXACTLY like apps/server/src/ws.ts (externalization skipped:
          // raw payloads only make chunks bigger, not structurally different).
          const built = buildSnapshotChunks({
            snapshotId: "diag-snapshot",
            head: snapshot.head as ThreadHead,
            messages: snapshot.messages,
            activities: snapshot.activities,
          });
          const items = [
            {
              kind: "snapshot-start" as const,
              snapshotId: "diag-snapshot",
              historyEpoch: snapshot.historyEpoch,
              watermark: snapshot.watermark,
              chunkCount: built.chunks.length,
              inlineBytes: built.inlineBytes,
            },
            ...built.chunks,
            {
              kind: "snapshot-complete" as const,
              snapshotId: "diag-snapshot",
              historyEpoch: snapshot.historyEpoch,
              lastAppliedSequence: snapshot.watermark,
              before: {
                message:
                  built.messages[0] === undefined
                    ? null
                    : { createdAt: built.messages[0].createdAt, messageId: built.messages[0].id },
                activity:
                  built.activities[0] === undefined
                    ? null
                    : {
                        createdAt: built.activities[0].createdAt,
                        activityId: built.activities[0].id,
                      },
              },
              hasOlderMessages: snapshot.head.counts.messages > built.messages.length,
              hasOlderActivities: snapshot.head.counts.activities > built.activities.length,
            },
          ];

          // Wire round-trip every item; report the exact item kind that fails.
          const decoded = items.map((item, index) => {
            try {
              const encoded = Schema.encodeUnknownSync(OrchestrationThreadV2StreamItem)(item);
              const json = JSON.parse(JSON.stringify(encoded)) as unknown;
              return Schema.decodeUnknownSync(OrchestrationThreadV2StreamItem)(json);
            } catch (error) {
              assert.fail(
                `thread ${threadId}: item[${index}] kind=${item.kind} failed wire round-trip:\n${String(error).slice(0, 1500)}`,
              );
            }
          });

          // Replay the client staging validations verbatim (threads.ts applyV2Item).
          interface StagingState {
            snapshotId: string;
            historyEpoch: number;
            watermark: number;
            chunkCount: number;
            nextIndex: number;
            head: unknown | null;
          }
          let staging: StagingState | null = null;
          let committed = false;
          for (const item of decoded) {
            if (item === undefined) continue;
            if (item.kind === "snapshot-start") {
              staging = {
                snapshotId: item.snapshotId,
                historyEpoch: item.historyEpoch,
                watermark: item.watermark,
                chunkCount: item.chunkCount,
                nextIndex: 0,
                head: null,
              };
            } else if (item.kind === "snapshot-chunk") {
              const current: StagingState | null = staging;
              if (current === null) {
                throw new Error(`thread ${threadId}: chunk before snapshot-start`);
              }
              if (current.nextIndex !== item.index) {
                throw new Error(
                  `thread ${threadId}: chunk index mismatch (expected ${current.nextIndex}, got ${item.index})`,
                );
              }
              if (item.head !== undefined) {
                if (current.head !== null) {
                  throw new Error(`thread ${threadId}: duplicate head chunk`);
                }
                current.head = item.head;
              }
              current.nextIndex += 1;
            } else if (item.kind === "snapshot-complete") {
              const current: StagingState | null = staging;
              if (current === null) {
                throw new Error(`thread ${threadId}: complete without start`);
              }
              if (current.nextIndex !== current.chunkCount) {
                throw new Error(
                  `thread ${threadId}: chunkCount mismatch (advertised ${current.chunkCount}, received ${current.nextIndex})`,
                );
              }
              if (current.head === null) {
                throw new Error(`thread ${threadId}: no head chunk received`);
              }
              if (current.historyEpoch !== item.historyEpoch) {
                throw new Error(`thread ${threadId}: historyEpoch mismatch`);
              }
              if (current.watermark !== item.lastAppliedSequence) {
                throw new Error(`thread ${threadId}: watermark mismatch`);
              }
              committed = true;
            }
          }
          assert.isTrue(committed, `thread ${threadId}: snapshot never completed staging`);
        }
      }),
    { timeout: 120_000 },
  );
});
