import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  OrchestrationThreadV2StreamItem,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ThreadHead,
  type ThreadWindowMessage,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  makeEnvironmentThreadState,
  type EnvironmentThreadState,
} from "./threads.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-1");

const HEAD: ThreadHead = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "V2 thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  session: null,
  activeProposedPlan: null,
  pendingRequests: [],
  counts: { messages: 40, activities: 200 },
};

const MESSAGE: ThreadWindowMessage = {
  id: "message-1" as ThreadWindowMessage["id"],
  role: "user",
  text: "hello from the tail window",
  turnId: null,
  streaming: false,
  createdAt: "2026-04-01T00:10:00.000Z",
  updatedAt: "2026-04-01T00:10:00.000Z",
};

// Simulate the wire: every item is encoded to its JSON wire form and decoded
// back, exactly as the RPC serialization layer does. This catches mismatches
// that in-memory fixtures hide (undefined vs missing, branded types, dates).
const wireRoundTrip = (item: OrchestrationThreadV2StreamItem): OrchestrationThreadV2StreamItem => {
  const encoded = Schema.encodeUnknownSync(OrchestrationThreadV2StreamItem)(item);
  const json = JSON.parse(JSON.stringify(encoded)) as unknown;
  return Schema.decodeUnknownSync(OrchestrationThreadV2StreamItem)(json);
};

// The exact head composition subscribeThreadV2 emits for a cold tail sync
// (apps/server/src/ws.ts): snapshot-start, chunks, snapshot-complete.
const v2SnapshotItems = (): ReadonlyArray<OrchestrationThreadV2StreamItem> => [
  {
    kind: "snapshot-start",
    snapshotId: "snap-1",
    historyEpoch: 0,
    watermark: 77,
    chunkCount: 1,
    inlineBytes: 1024,
  },
  {
    kind: "snapshot-chunk",
    snapshotId: "snap-1",
    index: 0,
    head: HEAD,
    messages: [MESSAGE],
    activities: [],
  },
  {
    kind: "snapshot-complete",
    snapshotId: "snap-1",
    historyEpoch: 0,
    lastAppliedSequence: 77,
    before: {
      message: { createdAt: MESSAGE.createdAt, messageId: MESSAGE.id },
      activity: null,
    },
    hasOlderMessages: true,
    hasOlderActivities: true,
  },
];

type TestInput = OrchestrationThreadV2StreamItem | Error;

function testSession(client: WsRpcProtocolClient): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function awaitThreadState(
  observed: Queue.Queue<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) {
  return Queue.take(observed).pipe(
    Effect.repeat({
      until: predicate,
    }),
  );
}

const makeHarness = Effect.fn("TestEnvironmentThreadsV2.makeHarness")(function* () {
  const inputs = yield* Queue.unbounded<TestInput>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const latest = yield* Ref.make<EnvironmentThreadState>(EMPTY_ENVIRONMENT_THREAD_STATE);
  const retryCount = yield* Ref.make(0);
  const subscriptionCount = yield* Ref.make(0);
  const savedWindows = yield* Ref.make<ReadonlyArray<unknown>>([]);
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const streamFrom = (queue: Queue.Queue<TestInput>) =>
    Stream.fromQueue(queue).pipe(
      Stream.mapEffect((input) =>
        input instanceof Error ? Effect.fail(input) : Effect.succeed(input),
      ),
    );
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThreadV2]: () =>
      Stream.unwrap(
        Ref.updateAndGet(subscriptionCount, (count) => count + 1).pipe(
          Effect.map(() => streamFrom(inputs)),
        ),
      ),
  } as unknown as WsRpcProtocolClient;
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(testSession(client)),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some({
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: TARGET.httpBaseUrl,
      socketUrl: "wss://environment.example.test/ws",
      rpcTransport: { kind: "json", path: "/ws" },
      threadSyncVersion: 2,
      httpAuthorization: null,
      target: TARGET,
    }),
  );
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Ref.update(retryCount, (count) => count + 1),
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeed(Option.none()),
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeed(Option.none()),
    saveThread: (_environmentId, thread) =>
      Ref.update(savedWindows, (current) => [...current, thread]),
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeed(Option.none()),
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeed(Option.none()),
    saveVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const loaderCalls = yield* Ref.make(0);
  const snapshotLoader = ThreadSnapshotLoader.of({
    load: () => Ref.update(loaderCalls, (count) => count + 1).pipe(Effect.as(Option.none())),
  });
  const threadState = yield* makeEnvironmentThreadState(THREAD_ID).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader, snapshotLoader),
  );
  yield* SubscriptionRef.changes(threadState).pipe(
    Stream.runForEach((state) =>
      Ref.set(latest, state).pipe(Effect.andThen(Queue.offer(observed, state))),
    ),
    Effect.forkScoped,
  );

  return {
    inputs,
    observed,
    latest,
    retryCount,
    subscriptionCount,
    savedWindows,
    loaderCalls,
  };
});

describe("EnvironmentThreads v2 wire integration", () => {
  it.effect("commits a wire-round-tripped tail snapshot and goes live", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (const item of v2SnapshotItems()) {
        yield* Queue.offer(harness.inputs, wireRoundTrip(item));
      }

      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );

      expect(state.status).toBe("live");
      expect(Option.isSome(state.data)).toBe(true);
      // No silent resync loop: the subscription must not have been retried.
      expect(yield* Ref.get(harness.retryCount)).toBe(0);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);
      // v2 must not fall back to the legacy HTTP snapshot loader.
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
    }),
  );
});
