import {
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { makeEnvironmentShellState, ShellSnapshotLoader } from "./shell.ts";
import { v2ShellSnapshot } from "./orchestrationV2TestFixtures.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};

const LIVE_SHELL_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  ...v2ShellSnapshot,
  snapshotSequence: 1,
};

function session(client: WsRpcProtocolClient): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("environment shell synchronization", () => {
  it.effect("publishes live state before persistence and preserves it when ready", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.none()),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      // Cold cache with no HTTP snapshot available → falls back to the
      // socket-embedded snapshot.
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () => Effect.succeed(Option.none()),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      yield* SubscriptionRef.set(supervisorState, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      yield* Queue.offer(events, {
        kind: "snapshot",
        snapshot: LIVE_SHELL_SNAPSHOT,
      });
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter((state) => state.status === "live"),
        Stream.runHead,
      );

      yield* SubscriptionRef.set(supervisorState, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 1,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      const state = yield* SubscriptionRef.get(shellState);
      expect(state.status).toBe("live");
      expect(Option.getOrThrow(state.snapshot)).toEqual(LIVE_SHELL_SNAPSHOT);
    }),
  );

  it.effect("restores live status after reconnect when no new shell events arrive", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.some(LIVE_SHELL_SNAPSHOT)),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () => Effect.succeed(Option.none()),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter((state) => state.status === "live"),
        Stream.runHead,
      );

      yield* SubscriptionRef.set(supervisorState, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 2,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter((state) => state.status === "synchronizing"),
        Stream.runHead,
      );

      yield* SubscriptionRef.set(supervisorState, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 2,
        generation: 2,
        lastFailure: null,
        retryAt: null,
      });
      const state = yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter((value) => value.status === "live"),
        Stream.runHead,
      );

      expect(Option.getOrThrow(state).status).toBe("live");
      expect(Option.getOrThrow(Option.getOrThrow(state).snapshot)).toEqual(LIVE_SHELL_SNAPSHOT);
    }),
  );

  it.effect("heals warm cache membership from HTTP before resuming afterSequence", () =>
    Effect.gen(function* () {
      const cachedSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 5,
      };
      // Server already archived the thread, but a high-sequence warm cache still
      // lists it as active because the archive delta was dropped earlier.
      const httpSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 4,
        threads: [],
        archivedThreads: [
          {
            ...v2ShellSnapshot.threads[0]!,
            archivedAt: v2ShellSnapshot.threads[0]!.updatedAt,
          },
        ],
      };
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const capturedAfterSequence = yield* SubscriptionRef.make<number | undefined>(undefined);
      const loaderCalls = yield* SubscriptionRef.make(0);
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input: {
          readonly afterSequence?: number;
        }) =>
          Stream.unwrap(
            SubscriptionRef.set(capturedAfterSequence, input.afterSequence).pipe(
              Effect.as(Stream.fromQueue(events)),
            ),
          ),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.some(cachedSnapshot)),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () =>
          SubscriptionRef.update(loaderCalls, (count) => count + 1).pipe(
            Effect.as(Option.some(httpSnapshot)),
          ),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      yield* SubscriptionRef.changes(capturedAfterSequence).pipe(
        Stream.filter((value) => value !== undefined),
        Stream.runHead,
      );
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter(
          (state) => Option.isSome(state.snapshot) && state.snapshot.value.threads.length === 0,
        ),
        Stream.runHead,
      );

      // HTTP heal is authoritative even when its sequence is behind the cache.
      expect(yield* SubscriptionRef.get(loaderCalls)).toBe(1);
      expect(yield* SubscriptionRef.get(capturedAfterSequence)).toBe(4);
      const snapshot = Option.getOrThrow((yield* SubscriptionRef.get(shellState)).snapshot);
      expect(snapshot.threads).toEqual([]);
      expect(snapshot.archivedThreads).toHaveLength(1);
    }),
  );

  it.effect("does not paint stale disk membership before the HTTP heal arrives", () =>
    Effect.gen(function* () {
      const cachedSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 5,
      };
      const httpSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 6,
        threads: [],
        archivedThreads: [
          {
            ...v2ShellSnapshot.threads[0]!,
            archivedAt: v2ShellSnapshot.threads[0]!.updatedAt,
          },
        ],
      };
      const httpReady = yield* Deferred.make<void>();
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      // Normal online connect starts with session:None while the lease opens.
      // Disk must not paint during that window either.
      const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>({
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "opening",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.none(),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.some(cachedSnapshot)),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () => Deferred.await(httpReady).pipe(Effect.as(Option.some(httpSnapshot))),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      for (let index = 0; index < 20; index += 1) {
        yield* Effect.yieldNow;
      }
      expect(Option.isNone((yield* SubscriptionRef.get(shellState)).snapshot)).toBe(true);

      yield* SubscriptionRef.set(activeSession, Option.some(session(client)));
      for (let index = 0; index < 20; index += 1) {
        yield* Effect.yieldNow;
      }
      // Still no disk paint while HTTP heal is in flight.
      expect(Option.isNone((yield* SubscriptionRef.get(shellState)).snapshot)).toBe(true);

      yield* Deferred.succeed(httpReady, undefined);
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter(
          (state) => Option.isSome(state.snapshot) && state.snapshot.value.threads.length === 0,
        ),
        Stream.runHead,
      );
      const snapshot = Option.getOrThrow((yield* SubscriptionRef.get(shellState)).snapshot);
      expect(snapshot.archivedThreads).toHaveLength(1);
    }),
  );

  it.effect("forces a full socket snapshot when HTTP heal fails with a warm cache", () =>
    Effect.gen(function* () {
      const cachedSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 50,
      };
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const capturedAfterSequence = yield* SubscriptionRef.make<number | undefined | "missing">(
        "missing",
      );
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input: {
          readonly afterSequence?: number;
        }) =>
          Stream.unwrap(
            SubscriptionRef.set(
              capturedAfterSequence,
              input.afterSequence === undefined ? undefined : input.afterSequence,
            ).pipe(Effect.as(Stream.fromQueue(events))),
          ),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.some(cachedSnapshot)),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () => Effect.succeed(Option.none()),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      yield* SubscriptionRef.changes(capturedAfterSequence).pipe(
        Stream.filter((value) => value !== "missing"),
        Stream.runHead,
      );

      // Cache alone must not drive afterSequence; socket should send a full snapshot.
      expect(yield* SubscriptionRef.get(capturedAfterSequence)).toBeUndefined();

      // Server membership is correct but sequence is behind the warm cache.
      // The socket heal must still apply (authoritative) or ghost threads remain.
      const archivedThread = {
        ...cachedSnapshot.threads[0]!,
        archivedAt: cachedSnapshot.threads[0]!.updatedAt,
      };
      yield* Queue.offer(events, {
        kind: "snapshot",
        snapshot: {
          ...cachedSnapshot,
          snapshotSequence: 40,
          threads: [],
          archivedThreads: [archivedThread],
        },
      });
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter(
          (state) => Option.isSome(state.snapshot) && state.snapshot.value.snapshotSequence === 40,
        ),
        Stream.runHead,
      );
      const snapshot = Option.getOrThrow((yield* SubscriptionRef.get(shellState)).snapshot);
      expect(snapshot.threads).toEqual([]);
      expect(snapshot.archivedThreads).toHaveLength(1);
    }),
  );

  it.effect("clears socket-authoritative flag after a successful HTTP heal on reconnect", () =>
    Effect.gen(function* () {
      const cachedSnapshot: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 50,
      };
      // Server already archived the thread; the heal must win over the stale
      // warm cache and later stale socket snapshots.
      const httpHealed: OrchestrationV2ShellSnapshot = {
        ...v2ShellSnapshot,
        snapshotSequence: 60,
        threads: [],
        archivedThreads: [
          {
            ...v2ShellSnapshot.threads[0]!,
            archivedAt: v2ShellSnapshot.threads[0]!.updatedAt,
          },
        ],
      };
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const subscribeCount = yield* Ref.make(0);
      const capturedAfterSequence = yield* SubscriptionRef.make<number | undefined | "missing">(
        "missing",
      );
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input: {
          readonly afterSequence?: number;
        }) =>
          Stream.unwrap(
            Ref.update(subscribeCount, (count) => count + 1).pipe(
              Effect.andThen(
                SubscriptionRef.set(
                  capturedAfterSequence,
                  input.afterSequence === undefined ? undefined : input.afterSequence,
                ),
              ),
              Effect.as(Stream.fromQueue(events)),
            ),
          ),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.some(cachedSnapshot)),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      // First session: HTTP fails (sets socket-authoritative). Second: HTTP heals.
      const loaderCalls = yield* Ref.make(0);
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () =>
          Ref.update(loaderCalls, (count) => count + 1).pipe(
            Effect.flatMap(() => Ref.get(loaderCalls)),
            Effect.map((count) => (count === 1 ? Option.none() : Option.some(httpHealed))),
          ),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      // First subscribe: HTTP failed, no afterSequence, flag armed.
      yield* SubscriptionRef.changes(capturedAfterSequence).pipe(
        Stream.filter((value) => value !== "missing"),
        Stream.runHead,
      );
      expect(yield* SubscriptionRef.get(capturedAfterSequence)).toBeUndefined();
      expect(yield* Ref.get(subscribeCount)).toBe(1);

      // Disconnect without delivering a socket snapshot, then reconnect.
      yield* SubscriptionRef.set(activeSession, Option.none());
      yield* SubscriptionRef.set(capturedAfterSequence, "missing");
      yield* SubscriptionRef.set(activeSession, Option.some(session(client)));

      yield* SubscriptionRef.changes(capturedAfterSequence).pipe(
        Stream.filter((value) => value !== "missing"),
        Stream.runHead,
      );
      expect(yield* SubscriptionRef.get(capturedAfterSequence)).toBe(60);
      expect(yield* Ref.get(loaderCalls)).toBe(2);

      // Stale enrichment-style snapshot must not override the HTTP heal.
      yield* Queue.offer(events, {
        kind: "snapshot",
        snapshot: {
          ...v2ShellSnapshot,
          snapshotSequence: 40,
        },
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }
      const snapshot = Option.getOrThrow((yield* SubscriptionRef.get(shellState)).snapshot);
      expect(snapshot.snapshotSequence).toBe(60);
      expect(snapshot.threads).toEqual([]);
      expect(snapshot.archivedThreads).toHaveLength(1);
    }),
  );

  it.effect("rejects a stale full snapshot after a newer archive delta", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
      const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
        Option.some(session(client)),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: supervisorState,
        session: activeSession,
        prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.none()),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeed(Option.none()),
        saveServerConfig: () => Effect.void,
        loadVcsRefs: () => Effect.succeed(Option.none()),
        saveVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });
      const snapshotLoader = ShellSnapshotLoader.of({
        load: () => Effect.succeed(Option.none()),
      });
      const shellState = yield* makeEnvironmentShellState().pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        Effect.provideService(ShellSnapshotLoader, snapshotLoader),
      );

      const liveSnapshot: OrchestrationV2ShellSnapshot = {
        ...LIVE_SHELL_SNAPSHOT,
        snapshotSequence: 2,
      };
      yield* Queue.offer(events, { kind: "snapshot", snapshot: liveSnapshot });
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter((state) => state.status === "live"),
        Stream.runHead,
      );

      const archivedThread = {
        ...liveSnapshot.threads[0]!,
        archivedAt: liveSnapshot.threads[0]!.updatedAt,
      };
      yield* Queue.offer(events, {
        kind: "thread.updated",
        sequence: 3,
        location: "archive",
        thread: archivedThread,
      });
      yield* SubscriptionRef.changes(shellState).pipe(
        Stream.filter(
          (state) => Option.isSome(state.snapshot) && state.snapshot.value.snapshotSequence === 3,
        ),
        Stream.runHead,
      );

      // Older full snapshot that still lists the thread as active must not win.
      yield* Queue.offer(events, {
        kind: "snapshot",
        snapshot: {
          ...liveSnapshot,
          snapshotSequence: 2,
          threads: liveSnapshot.threads,
          archivedThreads: [],
        },
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      const state = yield* SubscriptionRef.get(shellState);
      const snapshot = Option.getOrThrow(state.snapshot);
      expect(snapshot.snapshotSequence).toBe(3);
      expect(snapshot.threads).toEqual([]);
      expect(snapshot.archivedThreads.map((thread) => thread.id)).toEqual([archivedThread.id]);
    }),
  );
});
