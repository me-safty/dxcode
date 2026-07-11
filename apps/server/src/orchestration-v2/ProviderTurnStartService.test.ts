import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  MessageId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { ContextHandoffServiceV2 } from "./ContextHandoffService.ts";
import { EventSinkV2 } from "./EventSink.ts";
import { layer as idAllocatorLayer } from "./IdAllocator.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";
import type { ProviderAdapterV2SessionRuntime } from "./ProviderAdapter.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import {
  layer as providerTurnStartLayer,
  ProviderTurnStartServiceV2,
} from "./ProviderTurnStartService.ts";
import { RunExecutionServiceV2 } from "./RunExecutionService.ts";
import { layer as runtimePolicyLayer } from "./RuntimePolicy.ts";

const driver = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

type LifecycleMutation = "archive" | "delete";
type RacePoint = "after_open" | "before_running_write";

function makeProjection(input: {
  readonly now: DateTime.Utc;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
  readonly providerSessionId: ProviderSessionId;
  readonly providerThreadId: ProviderThreadId;
}): OrchestrationV2ThreadProjection {
  const rootNodeId = NodeId.make(`node:${input.runId}`);
  const messageId = MessageId.make(`message:${input.runId}`);
  const checkpointScopeId = CheckpointScopeId.make(`checkpoint-scope:${input.runId}`);
  return {
    thread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make(`project:${input.threadId}`),
      title: "Provider start lifecycle race",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/workspace",
      activeProviderThreadId: input.providerThreadId,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      deletedAt: null,
    },
    runs: [
      {
        id: input.runId,
        threadId: input.threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId: input.providerThreadId,
        userMessageId: messageId,
        rootNodeId,
        activeAttemptId: input.attemptId,
        status: "starting",
        queuePosition: null,
        requestedAt: input.now,
        startedAt: null,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    attempts: [
      {
        id: input.attemptId,
        runId: input.runId,
        attemptOrdinal: 1,
        rootNodeId,
        providerInstanceId,
        providerThreadId: input.providerThreadId,
        providerTurnId: null,
        reason: "initial",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    ],
    nodes: [
      {
        id: rootNodeId,
        threadId: input.threadId,
        runId: input.runId,
        parentNodeId: null,
        rootNodeId,
        kind: "root_turn",
        status: "pending",
        countsForRun: true,
        providerThreadId: input.providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId,
        startedAt: null,
        completedAt: null,
      },
    ],
    subagents: [],
    providerSessions: [],
    providerThreads: [
      {
        id: input.providerThreadId,
        driver,
        providerInstanceId,
        providerSessionId: input.providerSessionId,
        appThreadId: input.threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "not_loaded",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    ],
    providerTurns: [],
    runtimeRequests: [],
    messages: [
      {
        createdBy: "user",
        creationSource: "web",
        id: messageId,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        role: "user",
        text: "Start the provider turn.",
        attachments: [],
        streaming: false,
        createdAt: input.now,
        updatedAt: input.now,
      },
    ],
    plans: [],
    turnItems: [],
    checkpointScopes: [
      {
        id: checkpointScopeId,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: rootNodeId,
        parentScopeId: null,
        providerThreadId: input.providerThreadId,
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: "/workspace",
        createdAt: input.now,
      },
    ],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: input.now,
  };
}

function runLifecycleRaceTest(input: {
  readonly lifecycle: LifecycleMutation;
  readonly racePoint: RacePoint;
}) {
  return Effect.gen(function* () {
    const now = yield* DateTime.now;
    const threadId = ThreadId.make(`thread:provider-start:${input.lifecycle}:${input.racePoint}`);
    const runId = RunId.make(`run:provider-start:${input.lifecycle}:${input.racePoint}`);
    const attemptId = RunAttemptId.make(
      `attempt:provider-start:${input.lifecycle}:${input.racePoint}`,
    );
    const providerSessionId = ProviderSessionId.make(
      `session:provider-start:${input.lifecycle}:${input.racePoint}`,
    );
    const providerThreadId = ProviderThreadId.make(
      `provider-thread:provider-start:${input.lifecycle}:${input.racePoint}`,
    );
    const projection = yield* Ref.make(
      makeProjection({
        now,
        threadId,
        runId,
        attemptId,
        providerSessionId,
        providerThreadId,
      }),
    );
    const openCount = yield* Ref.make(0);
    const ensureThreadCount = yield* Ref.make(0);
    const detachCount = yield* Ref.make(0);
    const runningWriteCount = yield* Ref.make(0);
    const executionCount = yield* Ref.make(0);

    const mutateLifecycle = Ref.update(projection, (current) => ({
      ...current,
      thread: {
        ...current.thread,
        archivedAt: input.lifecycle === "archive" ? now : null,
        deletedAt: input.lifecycle === "delete" ? now : null,
        updatedAt: now,
      },
      ...(input.lifecycle === "delete"
        ? {
            runs: current.runs.map((run) =>
              run.id === runId ? { ...run, status: "cancelled" as const, completedAt: now } : run,
            ),
          }
        : {}),
    }));
    const providerSession = {
      id: providerSessionId,
      driver,
      providerInstanceId,
      status: "ready" as const,
      cwd: "/workspace",
      model: modelSelection.model,
      capabilities: CodexProviderCapabilitiesV2,
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
    const runtime: ProviderAdapterV2SessionRuntime = {
      instanceId: providerInstanceId,
      driver,
      providerSessionId,
      providerSession,
      events: Stream.empty,
      ensureThread: () =>
        Effect.gen(function* () {
          yield* Ref.update(ensureThreadCount, (count) => count + 1);
          return (yield* Ref.get(projection)).providerThreads[0]!;
        }),
      resumeThread: () => Effect.die("resumeThread is unused"),
      startTurn: () => Effect.die("startTurn is unused"),
      steerTurn: () => Effect.die("steerTurn is unused"),
      interruptTurn: () => Effect.die("interruptTurn is unused"),
      respondToRuntimeRequest: () => Effect.die("respondToRuntimeRequest is unused"),
      readThreadSnapshot: () => Effect.die("readThreadSnapshot is unused"),
      rollbackThread: () => Effect.die("rollbackThread is unused"),
      forkThread: () => Effect.die("forkThread is unused"),
    };
    const dependencies = Layer.mergeAll(
      Layer.mock(EventSinkV2)({
        write: () => Effect.succeed([]),
        writeIfRunCurrent: () =>
          Effect.gen(function* () {
            yield* Ref.update(runningWriteCount, (count) => count + 1);
            if (input.racePoint === "before_running_write") {
              yield* mutateLifecycle;
              return { committed: false as const, storedEvents: [] };
            }
            return { committed: true as const, storedEvents: [] };
          }),
      }),
      Layer.mock(ContextHandoffServiceV2)({}),
      idAllocatorLayer,
      Layer.mock(ProjectionStoreV2)({
        getThreadProjection: () => Ref.get(projection),
      }),
      Layer.succeed(
        ProviderSessionManagerV2,
        ProviderSessionManagerV2.of({
          shutdown: Effect.void,
          open: () =>
            Effect.gen(function* () {
              yield* Ref.update(openCount, (count) => count + 1);
              if (input.racePoint === "after_open") {
                yield* mutateLifecycle;
              }
              return runtime;
            }),
          get: () => Effect.succeed(Option.none()),
          close: () => Effect.void,
          release: () => Effect.void,
          detach: () => Ref.update(detachCount, (count) => count + 1),
        }),
      ),
      Layer.mock(RunExecutionServiceV2)({
        startRootRun: () => Ref.update(executionCount, (count) => count + 1),
      }),
      runtimePolicyLayer,
    );
    const testLayer = providerTurnStartLayer.pipe(Layer.provide(dependencies));

    yield* Effect.gen(function* () {
      const service = yield* ProviderTurnStartServiceV2;
      yield* service.start({ threadId, runId });
    }).pipe(Effect.provide(testLayer));

    assert.equal(yield* Ref.get(openCount), 1);
    assert.equal(yield* Ref.get(detachCount), 1);
    assert.equal(yield* Ref.get(executionCount), 0);
    if (input.racePoint === "after_open") {
      assert.equal(yield* Ref.get(ensureThreadCount), 0);
      assert.equal(yield* Ref.get(runningWriteCount), 0);
    } else {
      assert.equal(yield* Ref.get(ensureThreadCount), 1);
      assert.equal(yield* Ref.get(runningWriteCount), 1);
    }
  });
}

it.effect("detaches a provider session when deletion wins immediately after open", () =>
  runLifecycleRaceTest({ lifecycle: "delete", racePoint: "after_open" }),
);

it.effect("detaches a provider session when archival wins the running-state commit", () =>
  runLifecycleRaceTest({ lifecycle: "archive", racePoint: "before_running_write" }),
);
