import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadV2StreamItem,
  type OrchestrationThreadStreamItem,
  type ThreadId as ThreadIdType,
  type ThreadHead,
  type ThreadWindowMessage,
  type WindowedOrchestrationThread,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase, type PreparedConnection } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { type CachedThreadSnapshot, EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribe } from "../rpc/client.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import {
  applyWindowedThreadEvent,
  fromWindowSnapshot,
  isWindowedThread,
  mergeWindowHistoryPage,
  toWindowSnapshot,
  type ThreadDetailData,
  type WindowedOrchestrationThreadState,
} from "./windowedThread.ts";
import { THREAD_STATE_IDLE_TTL_MS } from "./threadRetention.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  type EnvironmentThreadStatus,
} from "./threadState.ts";

function statusWithoutLiveData(data: Option.Option<ThreadDetailData>): EnvironmentThreadStatus {
  return Option.isSome(data) ? "cached" : "empty";
}

function isWindowSnapshot(
  value: OrchestrationThread | CachedThreadSnapshot,
): value is WindowedOrchestrationThread {
  return "syncVersion" in value && value.syncVersion === 2 && "head" in value;
}

function formatThreadError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize the thread.";
}

export const makeEnvironmentThreadState = Effect.fn("EnvironmentThreadState.make")(function* (
  threadId: ThreadIdType,
) {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ThreadSnapshotLoader;
  const environmentId = supervisor.target.environmentId;
  const cached = yield* cache.loadThread(environmentId, threadId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached thread.").pipe(
        Effect.annotateLogs({
          environmentId,
          threadId,
          error: error.message,
        }),
        Effect.as(Option.none<CachedThreadSnapshot>()),
      ),
    ),
  );
  const cachedThread = Option.map(
    cached,
    (entry): ThreadDetailData =>
      isWindowSnapshot(entry) ? fromWindowSnapshot(entry) : entry.thread,
  );
  let loadOlderImpl: () => Promise<void> = () => Promise.resolve();
  const loadOlder = () => loadOlderImpl();
  const state = yield* SubscriptionRef.make<EnvironmentThreadState>({
    data: cachedThread,
    status: statusWithoutLiveData(cachedThread),
    error: Option.none(),
    hasOlder: Option.match(cachedThread, {
      onNone: () => false,
      onSome: (thread) =>
        isWindowedThread(thread) && (thread.hasOlderMessages || thread.hasOlderActivities),
    }),
    loadingOlder: false,
    loadOlder,
  });
  // Seed the resume cursor from the persisted snapshot (legacy `snapshotSequence`
  // or windowed `lastAppliedSequence`) so a cold start resumes incrementally
  // instead of re-downloading the whole thread.
  const cachedSequence = (entry: CachedThreadSnapshot): number =>
    isWindowSnapshot(entry) ? entry.lastAppliedSequence : entry.snapshotSequence;
  const lastSequence = yield* SubscriptionRef.make(
    Option.match(cached, {
      onNone: () => 0,
      onSome: cachedSequence,
    }),
  );
  const persistence = yield* Queue.sliding<{
    readonly thread: ThreadDetailData;
    readonly sequence: number;
  }>(1);
  // The last CONSISTENT {thread, sequence} pair committed by setThread. The scope
  // finalizer persists THIS (Fix 2) rather than reading `state` and `lastSequence`
  // from two separate refs — an interrupted apply can leave those torn (cursor
  // advanced, thread not yet committed), and persisting a cursor ahead of its
  // thread makes reconnect deltas skip the gap forever. A plain assignment is
  // synchronous/uninterruptible, so this is always a matched pair.
  let lastPersistable: {
    readonly thread: ThreadDetailData;
    readonly sequence: number;
  } | null = Option.match(cachedThread, {
    onNone: () => null,
    onSome: (thread) => ({
      thread,
      sequence: Option.match(cached, {
        onNone: () => 0,
        onSome: cachedSequence,
      }),
    }),
  });

  const persist = Effect.fn("EnvironmentThreadState.persist")(function* (entry: {
    readonly thread: ThreadDetailData;
    readonly sequence: number;
  }) {
    yield* cache
      .saveThread(
        environmentId,
        isWindowedThread(entry.thread)
          ? toWindowSnapshot(entry.thread)
          : { snapshotSequence: entry.sequence, thread: entry.thread },
      )
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not persist the thread cache.").pipe(
            Effect.annotateLogs({
              environmentId,
              threadId,
              error: error.message,
            }),
          ),
        ),
      );
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce("500 millis"),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  const setSynchronizing = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: "synchronizing" as const,
    error: Option.none(),
  }));
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live" || current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setDisconnected = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
  }));
  const setStreamError = (cause: Cause.Cause<unknown>) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
      error: Option.some(formatThreadError(cause)),
    }));

  const setThread = Effect.fn("EnvironmentThreadState.setThread")(function* (
    inputThread: ThreadDetailData,
    sequence: number,
  ) {
    const thread = isWindowedThread(inputThread)
      ? { ...inputThread, lastAppliedSequence: sequence }
      : inputThread;
    // Advance the thread state and the cursor together under `uninterruptible`
    // so an interrupt (e.g. a reconnect) can never leave `lastSequence` out of
    // step with the committed thread (Fix 2c). A cursor AHEAD of its thread
    // makes the reconnect delta skip the gap forever; a cursor BEHIND it lets a
    // re-sent event slip past the dedup guard and be applied twice.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* SubscriptionRef.update(state, (current) => ({
          ...current,
          data: Option.some(thread),
          status: "live" as const,
          error: Option.none(),
          hasOlder:
            isWindowedThread(thread) && (thread.hasOlderMessages || thread.hasOlderActivities),
        }));
        yield* SubscriptionRef.set(lastSequence, sequence);
      }),
    );
    yield* Queue.offer(persistence, { thread, sequence });
    lastPersistable = { thread, sequence };
  });

  const setDeleted = Effect.fn("EnvironmentThreadState.setDeleted")(function* (sequence?: number) {
    // Commit the deletion and advance the cursor together (Fix 2c) so a
    // reconnect after an interrupt never resubscribes from a cursor out of step
    // with the (now empty) thread state.
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* SubscriptionRef.update(state, (current) => ({
          ...current,
          data: Option.none(),
          status: "deleted" as const,
          error: Option.none(),
          hasOlder: false,
          loadingOlder: false,
        }));
        if (sequence !== undefined) {
          yield* SubscriptionRef.set(lastSequence, sequence);
        }
      }),
    );
    // Clear the persistable pair so the scope finalizer cannot resurrect a
    // just-deleted thread back into the cache (Fix 2 review).
    lastPersistable = null;
    yield* cache.removeThread(environmentId, threadId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove the cached thread.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  const applyItem = Effect.fn("EnvironmentThreadState.applyItem")(function* (
    item: OrchestrationThreadStreamItem,
  ) {
    if (item.kind === "snapshot") {
      // setThread advances the cursor atomically with the thread (Fix 2c).
      yield* setThread(item.snapshot.thread, item.snapshot.snapshotSequence);
      return;
    }

    if (item.kind === "catchup") {
      // Incremental sync (Fix 2): keep the cached thread and apply the `event`
      // items that follow. The cursor is already at `fromSequence` (the
      // `sinceSequence` we requested); advance it defensively and mark the
      // stream live so a zero-delta catch-up clears "synchronizing" without
      // re-downloading anything.
      yield* SubscriptionRef.update(lastSequence, (seq) => Math.max(seq, item.fromSequence));
      yield* SubscriptionRef.update(state, (current) =>
        current.status === "deleted" || Option.isNone(current.data)
          ? current
          : { ...current, status: "live" as const, error: Option.none() },
      );
      return;
    }

    const sequence = yield* SubscriptionRef.get(lastSequence);
    if (item.event.sequence <= sequence) {
      return;
    }

    const current = yield* SubscriptionRef.get(state);
    if (Option.isNone(current.data)) {
      if (item.event.type === "thread.deleted") {
        yield* setDeleted(item.event.sequence);
      } else {
        // No thread to apply the event to yet; advance the cursor so we don't
        // reprocess it (Fix 2c: the cursor only moves with committed state).
        yield* SubscriptionRef.set(lastSequence, item.event.sequence);
      }
      return;
    }
    if (isWindowedThread(current.data.value)) {
      // A server downgrade cannot safely apply legacy deltas to a partial v2
      // window. The v1 subscribe input omits its cursor, so a snapshot follows.
      return;
    }
    const result = applyThreadDetailEvent(current.data.value, item.event);
    if (result.kind === "updated") {
      yield* setThread(result.thread, item.event.sequence);
    } else if (result.kind === "deleted") {
      yield* setDeleted(item.event.sequence);
    } else {
      // Event left the thread unchanged; advance the cursor past it so a
      // reconnect resumes correctly and we never reprocess it.
      yield* SubscriptionRef.set(lastSequence, item.event.sequence);
    }
  });

  interface SnapshotStaging {
    readonly snapshotId: string;
    readonly historyEpoch: number;
    readonly watermark: number;
    readonly chunkCount: number;
    nextIndex: number;
    head: ThreadHead | null;
    messages: ThreadWindowMessage[];
    activities: OrchestrationThreadActivity[];
  }
  let staging: SnapshotStaging | null = null;
  let pendingCatchup: { remaining: number; readonly toSequence: number } | null = null;
  const forceV2Snapshot = yield* Ref.make(false);
  // Resync must RESTART the v2 subscription itself. `supervisor.retryNow` is a
  // no-op while the connection is healthy, so relying on it alone left the
  // stream running with cleared staging — consuming live events forever without
  // ever committing a snapshot (an unrecoverable silent hang on-device).
  const v2Resync = yield* Queue.unbounded<string>();
  const requestV2Resync = Effect.fn("EnvironmentThreadState.requestV2Resync")(function* (
    reason: string,
  ) {
    staging = null;
    pendingCatchup = null;
    yield* Effect.logWarning("Thread sync v2 resync requested.").pipe(
      Effect.annotateLogs({ environmentId, threadId, reason }),
    );
    yield* Ref.set(forceV2Snapshot, true);
    yield* Queue.offer(v2Resync, reason);
  });
  const finishV2CatchupEvent = Effect.fn("EnvironmentThreadState.finishV2CatchupEvent")(
    function* () {
      if (pendingCatchup === null) return;
      pendingCatchup.remaining -= 1;
      if (pendingCatchup.remaining > 0) return;
      const toSequence = pendingCatchup.toSequence;
      pendingCatchup = null;
      const current = yield* SubscriptionRef.get(state);
      if (Option.isNone(current.data) || !isWindowedThread(current.data.value)) return;
      const sequence = yield* SubscriptionRef.get(lastSequence);
      yield* setThread(current.data.value, Math.max(sequence, toSequence));
    },
  );

  const applyV2Item = Effect.fn("EnvironmentThreadState.applyV2Item")(function* (
    item: OrchestrationThreadV2StreamItem,
  ) {
    switch (item.kind) {
      case "snapshot-start":
        pendingCatchup = null;
        staging = {
          snapshotId: item.snapshotId,
          historyEpoch: item.historyEpoch,
          watermark: item.watermark,
          chunkCount: item.chunkCount,
          nextIndex: 0,
          head: null,
          messages: [],
          activities: [],
        };
        return;
      case "snapshot-chunk":
        if (
          staging === null ||
          staging.snapshotId !== item.snapshotId ||
          staging.nextIndex !== item.index
        ) {
          yield* requestV2Resync(
            staging === null
              ? "chunk-without-start"
              : staging.snapshotId !== item.snapshotId
                ? "chunk-snapshot-id-mismatch"
                : `chunk-order (expected ${staging.nextIndex}, got ${item.index})`,
          );
          return;
        }
        if (item.head !== undefined) {
          if (staging.head !== null) {
            yield* requestV2Resync("duplicate-head-chunk");
            return;
          }
          staging.head = item.head;
        }
        staging.messages.push(...item.messages);
        staging.activities.push(...item.activities);
        staging.nextIndex += 1;
        return;
      case "snapshot-complete": {
        const completed = staging;
        staging = null;
        if (
          completed === null ||
          completed.snapshotId !== item.snapshotId ||
          completed.nextIndex !== completed.chunkCount ||
          completed.head === null ||
          completed.historyEpoch !== item.historyEpoch ||
          completed.watermark !== item.lastAppliedSequence
        ) {
          yield* requestV2Resync(
            completed === null
              ? "complete-without-start"
              : completed.snapshotId !== item.snapshotId
                ? "complete-snapshot-id-mismatch"
                : completed.nextIndex !== completed.chunkCount
                  ? `chunk-count (advertised ${completed.chunkCount}, received ${completed.nextIndex})`
                  : completed.head === null
                    ? "missing-head-chunk"
                    : completed.historyEpoch !== item.historyEpoch
                      ? "complete-epoch-mismatch"
                      : `watermark (start ${completed.watermark}, complete ${item.lastAppliedSequence})`,
          );
          return;
        }
        const window: WindowedOrchestrationThread = {
          syncVersion: 2,
          historyEpoch: item.historyEpoch,
          lastAppliedSequence: item.lastAppliedSequence,
          head: completed.head,
          messages: completed.messages,
          activities: completed.activities,
          before: item.before,
          hasOlderMessages: item.hasOlderMessages,
          hasOlderActivities: item.hasOlderActivities,
        };
        yield* setThread(fromWindowSnapshot(window), item.lastAppliedSequence);
        yield* Ref.set(forceV2Snapshot, false);
        return;
      }
      case "catchup": {
        const current = yield* SubscriptionRef.get(state);
        const sequence = yield* SubscriptionRef.get(lastSequence);
        if (
          Option.isNone(current.data) ||
          !isWindowedThread(current.data.value) ||
          current.data.value.historyEpoch !== item.historyEpoch ||
          sequence !== item.fromSequence
        ) {
          yield* requestV2Resync(
            Option.isNone(current.data)
              ? "catchup-without-data"
              : !isWindowedThread(current.data.value)
                ? "catchup-on-legacy-thread"
                : current.data.value.historyEpoch !== item.historyEpoch
                  ? "catchup-epoch-mismatch"
                  : `catchup-cursor (local ${sequence}, server ${item.fromSequence})`,
          );
          return;
        }
        if (item.eventCount === 0) {
          yield* setThread(current.data.value, item.toSequence);
          return;
        }
        pendingCatchup = { remaining: item.eventCount, toSequence: item.toSequence };
        yield* SubscriptionRef.update(state, (value) => ({
          ...value,
          status: "live" as const,
          error: Option.none(),
        }));
        return;
      }
      case "event": {
        const sequence = yield* SubscriptionRef.get(lastSequence);
        if (item.event.sequence <= sequence) {
          yield* finishV2CatchupEvent();
          return;
        }
        const current = yield* SubscriptionRef.get(state);
        if (Option.isNone(current.data)) {
          if (item.event.type === "thread.deleted") {
            yield* setDeleted(item.event.sequence);
          } else {
            yield* requestV2Resync("event-without-data");
          }
          return;
        }
        if (!isWindowedThread(current.data.value)) {
          yield* requestV2Resync("event-on-legacy-thread");
          return;
        }
        const result = applyWindowedThreadEvent(current.data.value, item.event);
        switch (result.kind) {
          case "updated":
            yield* setThread(result.thread, item.event.sequence);
            yield* finishV2CatchupEvent();
            return;
          case "deleted":
            pendingCatchup = null;
            yield* setDeleted(item.event.sequence);
            return;
          case "resync":
            yield* requestV2Resync(`event-reducer-resync (${item.event.type})`);
            return;
          case "unchanged":
            yield* setThread(current.data.value, item.event.sequence);
            yield* finishV2CatchupEvent();
            return;
        }
      }
      case "resync-required":
        yield* requestV2Resync(`server-resync-required (${item.reason})`);
        return;
      case "keepalive":
        yield* SubscriptionRef.update(state, (current) => ({
          ...current,
          status: current.status === "deleted" ? current.status : ("live" as const),
          error: Option.none(),
        }));
        return;
    }
  });

  const olderRequestInFlight = yield* Ref.make(false);
  const loadOlderEffect = Effect.gen(function* () {
    const acquired = yield* Ref.modify(olderRequestInFlight, (active) =>
      active ? [false, active] : [true, true],
    );
    if (!acquired) return;
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      loadingOlder: true,
    }));
    yield* Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      if (Option.isNone(current.data) || !isWindowedThread(current.data.value)) return;
      const thread = current.data.value;
      if (!thread.hasOlderMessages && !thread.hasOlderActivities) return;
      const session = yield* SubscriptionRef.get(supervisor.session);
      if (Option.isNone(session)) return;
      const page = yield* session.value.client[ORCHESTRATION_WS_METHODS.getThreadHistoryPage]({
        threadId,
        historyEpoch: thread.historyEpoch,
        before: thread.before,
        messageLimit: 32,
        activityLimit: 128,
      });
      // Re-read the thread AFTER the RPC: live events (especially a revert,
      // which changes the history epoch) may have advanced it while the page
      // was in flight, and committing a merge of the stale pre-request window
      // would roll the thread back. Merge into the CURRENT window and drop the
      // page entirely if the epoch moved (the resync already reloaded the tail).
      const latest = yield* SubscriptionRef.get(state);
      if (Option.isNone(latest.data) || !isWindowedThread(latest.data.value)) return;
      const latestThread = latest.data.value;
      if (latestThread.historyEpoch !== thread.historyEpoch) return;
      const next: WindowedOrchestrationThreadState = mergeWindowHistoryPage(latestThread, page);
      yield* setThread(next, latestThread.lastAppliedSequence);
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not load older thread history.", {
          environmentId,
          threadId,
          cause,
        }).pipe(Effect.andThen(requestV2Resync("history-page-failed"))),
      ),
      Effect.ensuring(
        Effect.all(
          [
            Ref.set(olderRequestInFlight, false),
            SubscriptionRef.update(state, (current) => ({
              ...current,
              loadingOlder: false,
            })),
          ],
          { discard: true },
        ),
      ),
    );
  });
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  loadOlderImpl = () => runPromise(loadOlderEffect);

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  const resolveV2SubscribeInput = Effect.gen(function* () {
    const seq = yield* SubscriptionRef.get(lastSequence);
    const current = yield* SubscriptionRef.get(state);
    const forceSnapshot = yield* Ref.get(forceV2Snapshot);
    return !forceSnapshot &&
      seq > 0 &&
      Option.isSome(current.data) &&
      isWindowedThread(current.data.value)
      ? {
          threadId,
          sinceSequence: seq,
          historyEpoch: current.data.value.historyEpoch,
        }
      : { threadId };
  });

  yield* setSynchronizing;
  // Legacy (v1) flow — upstream's HTTP-snapshot + afterSequence resume,
  // activated per prepared connection when v2 is not negotiated:
  // - Warm cache: reuse the cached snapshot (zero network) and resume via
  //   `afterSequence` so we only receive events since it.
  // - Cold cache: load the full snapshot over HTTP (gzip-compressible, and
  //   off the socket), then resume via `afterSequence`.
  // A windowed (v2) cache cannot seed the legacy reducer, so it is treated as
  // cold here; the on-screen cached window remains until the full snapshot
  // arrives. Overlapping/replayed events are deduped by sequence in applyItem.
  const legacyFlow = (prepared: PreparedConnection) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const legacyCached =
          Option.isSome(cached) && !isWindowSnapshot(cached.value)
            ? Option.some(cached.value)
            : Option.none<OrchestrationThreadDetailSnapshot>();
        const base = Option.isSome(legacyCached)
          ? legacyCached
          : yield* snapshotLoader.load(prepared, threadId);

        if (Option.isSome(base)) {
          yield* applyItem({ kind: "snapshot", snapshot: base.value });
        }

        const subscribeInput = Option.match(base, {
          onNone: () => ({ threadId }),
          onSome: (snapshot) => ({ threadId, afterSequence: snapshot.snapshotSequence }),
        });

        return subscribe(ORCHESTRATION_WS_METHODS.subscribeThread, subscribeInput, {
          onExpectedFailure: setStreamError,
          retryExpectedFailureAfter: "250 millis",
        });
      }),
    );

  // ONE pipeline owns the thread. A single switchMap over negotiation changes
  // (merged with v2 resync signals, which re-read `prepared` and — with
  // forceV2Snapshot set — request a fresh tail) selects EITHER the v2 or the
  // legacy subscription, so a v1<->v2 transition atomically cancels one and
  // starts the other; two independently forked pipelines could briefly overlap
  // or both go dark during the handoff.
  type SyncItem =
    | { readonly v: 2; readonly item: OrchestrationThreadV2StreamItem }
    | { readonly v: 1; readonly item: OrchestrationThreadStreamItem };
  const syncTriggers = Stream.merge(
    SubscriptionRef.changes(supervisor.prepared),
    Stream.fromQueue(v2Resync).pipe(
      Stream.mapEffect(() => SubscriptionRef.get(supervisor.prepared)),
    ),
  );
  yield* syncTriggers.pipe(
    Stream.switchMap(
      Option.match({
        onNone: () => Stream.empty as Stream.Stream<SyncItem, never>,
        onSome: (connection) =>
          connection.threadSyncVersion === 2
            ? subscribe(ORCHESTRATION_WS_METHODS.subscribeThreadV2, resolveV2SubscribeInput, {
                onExpectedFailure: setStreamError,
                retryExpectedFailureAfter: "250 millis",
              }).pipe(Stream.map((item): SyncItem => ({ v: 2, item })))
            : legacyFlow(connection).pipe(Stream.map((item): SyncItem => ({ v: 1, item }))),
      }),
    ),
    Stream.runForEach((entry) => (entry.v === 2 ? applyV2Item(entry.item) : applyItem(entry.item))),
    // Surface silent fiber deaths (defects kill the forked pipeline without any
    // user-visible signal otherwise — the thread just never loads).
    Effect.tapCause((cause) =>
      Effect.logError("Thread sync pipeline failed.").pipe(
        Effect.annotateLogs({ environmentId, threadId, cause: Cause.pretty(cause) }),
      ),
    ),
    Effect.forkScoped,
  );

  // Persist the last CONSISTENT
  // Persist the last CONSISTENT {thread, sequence} pair on teardown (Fix 2).
  // Deliberately does NOT read `state` + `lastSequence` separately: those two
  // refs can be momentarily torn by an interrupted apply, and persisting a cursor
  // ahead of its thread would make reconnect deltas skip the gap permanently.
  yield* Effect.addFinalizer(() =>
    lastPersistable === null ? Effect.void : persist(lastPersistable),
  );

  return state;
});

export function threadStateChanges(environmentId: EnvironmentIdType, threadId: ThreadIdType) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(makeEnvironmentThreadState(threadId).pipe(Effect.map(SubscriptionRef.changes))),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ThreadSnapshotLoader | R,
    E
  >,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return runtime
      .atom(threadStateChanges(environmentId, threadId), {
        initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
      })
      .pipe(
        Atom.setIdleTTL(THREAD_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-thread-state:${key}`),
      );
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
  };
}

export * from "./archivedThreads.ts";
export * from "./checkpointDiff.ts";
export * from "./threadSnapshotHttp.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";
export * from "./windowedThread.ts";
