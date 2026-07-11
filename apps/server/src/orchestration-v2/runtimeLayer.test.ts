import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type ApplicationStoredEvent,
  CommandId,
  MessageId,
  type ModelSelection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { ProjectEnrichmentService } from "../project/ProjectEnrichmentService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { layer as mcpSessionRegistryTestLayer } from "../mcp/McpSessionRegistry.testkit.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { OrchestrationEffectWorkerV2 } from "./EffectWorker.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import { OrchestrationV2LayerLive } from "./runtimeLayer.ts";
import { shellStreamItemFromSnapshot } from "./ShellStream.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-orchestration-v2-runtime-layer-",
});

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;

const VcsDriverRegistryTestLayer = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);

const CheckpointStoreTestLayer = CheckpointStore.layer.pipe(
  Layer.provide(VcsDriverRegistryTestLayer),
);

const driver = ProviderDriverKind.make("codex");
const orchestrationAdapter = {
  instanceId: modelSelection.instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("sessions are not used by lifecycle tests"),
} as ProviderAdapterV2Shape;
const providerInstance = {
  instanceId: modelSelection.instanceId,
  driverKind: driver,
  continuationIdentity: {
    driverKind: driver,
    continuationKey: "codex:test",
  },
  displayName: "Codex test",
  enabled: true,
  snapshot: {} as ProviderInstance["snapshot"],
  orchestrationAdapter,
  textGeneration: {} as ProviderInstance["textGeneration"],
} satisfies ProviderInstance;

const TestProviderInstanceRegistry = Layer.succeed(ProviderInstanceRegistry, {
  getInstance: (instanceId) =>
    Effect.succeed(instanceId === providerInstance.instanceId ? providerInstance : undefined),
  listInstances: Effect.succeed([providerInstance]),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.never,
});

const TestLayer = OrchestrationV2LayerLive.pipe(
  Layer.provide(mcpSessionRegistryTestLayer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(CheckpointStoreTestLayer),
  Layer.provide(ServerConfigLayer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(TestProviderInstanceRegistry),
  Layer.provide(NodeServices.layer),
);

const SharedApplicationDataPlaneTestLayer = Layer.merge(
  OrchestrationLayerLive,
  OrchestrationV2LayerLive,
).pipe(
  Layer.provide(
    Layer.succeed(ProjectEnrichmentService, {
      peek: () => Effect.succeed({ repositoryIdentity: null, faviconPath: null }),
      request: () => Effect.void,
      getAvailable: () => Effect.succeed({ repositoryIdentity: null, faviconPath: null }),
      invalidate: () => Effect.void,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(mcpSessionRegistryTestLayer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(CheckpointStoreTestLayer),
  Layer.provide(ServerConfigLayer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(TestProviderInstanceRegistry),
  Layer.provide(NodeServices.layer),
);

it.layer(TestLayer)("OrchestrationV2LayerLive", (it) => {
  it.effect("creates and reads a thread through the production V2 composition", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorV2;
      const threadId = ThreadId.make("runtime-layer-thread");
      const projectId = ProjectId.make("runtime-layer-project");

      const result = yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("runtime-layer-create"),
        threadId,
        projectId,
        title: "Runtime layer thread",
        modelSelection: modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });

      const projection = yield* orchestrator.getThreadProjection(threadId);

      assert.equal(result.sequence, 1);
      assert.equal(projection.thread.id, threadId);
      assert.equal(projection.thread.projectId, projectId);
      assert.equal(projection.thread.providerInstanceId, "codex");
      assert.deepEqual(projection.runs, []);
    }),
  );

  it.effect("applies lifecycle commands idempotently and emits archive/removal shell deltas", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorV2;
      const threadId = ThreadId.make("runtime-layer-lifecycle-thread");
      const create = {
        type: "thread.create" as const,
        createdBy: "user" as const,
        creationSource: "web" as const,
        commandId: CommandId.make("runtime-layer-lifecycle-create"),
        threadId,
        projectId: ProjectId.make("runtime-layer-lifecycle-project"),
        title: "Lifecycle thread",
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
      };

      const firstCreate = yield* orchestrator.dispatch(create);
      const retriedCreate = yield* orchestrator.dispatch(create);
      assert.equal(retriedCreate.sequence, firstCreate.sequence);
      assert.lengthOf(retriedCreate.storedEvents, 1);

      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("runtime-layer-lifecycle-metadata"),
        threadId,
        title: "Renamed lifecycle thread",
        branch: "feature/v2",
        worktreePath: "/tmp/t3-v2-worktree",
      });
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("runtime-layer-lifecycle-runtime"),
        threadId,
        runtimeMode: "approval-required",
      });
      yield* orchestrator.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("runtime-layer-lifecycle-interaction"),
        threadId,
        interactionMode: "plan",
      });
      yield* orchestrator.dispatch({
        type: "thread.model-selection.set",
        commandId: CommandId.make("runtime-layer-lifecycle-model"),
        threadId,
        modelSelection: { ...modelSelection, model: "gpt-5.5" },
      });

      const archive = yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("runtime-layer-lifecycle-archive"),
        threadId,
      });
      const archivedShell = yield* orchestrator.getShellSnapshot();
      assert.notInclude(
        archivedShell.threads.map((thread) => thread.id),
        threadId,
      );
      assert.include(
        archivedShell.archivedThreads.map((thread) => thread.id),
        threadId,
      );
      assert.deepEqual(
        shellStreamItemFromSnapshot({
          stored: archive.storedEvents[0]!,
          snapshot: archivedShell,
        }),
        {
          kind: "thread.updated",
          sequence: archive.sequence,
          location: "archive",
          thread: archivedShell.archivedThreads[0]!,
        },
      );

      const remove = yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("runtime-layer-lifecycle-delete"),
        threadId,
      });
      const deletedShell = yield* orchestrator.getShellSnapshot();
      assert.notInclude(
        deletedShell.threads.map((thread) => thread.id),
        threadId,
      );
      assert.notInclude(
        deletedShell.archivedThreads.map((thread) => thread.id),
        threadId,
      );
      assert.deepEqual(
        shellStreamItemFromSnapshot({ stored: remove.storedEvents[0]!, snapshot: deletedShell }),
        {
          kind: "thread.removed",
          sequence: remove.sequence,
          location: "archive",
          threadId,
        },
      );

      const projection = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(projection.thread.title, "Renamed lifecycle thread");
      assert.equal(projection.thread.branch, "feature/v2");
      assert.equal(projection.thread.worktreePath, "/tmp/t3-v2-worktree");
      assert.equal(projection.thread.runtimeMode, "approval-required");
      assert.equal(projection.thread.interactionMode, "plan");
      assert.equal(projection.thread.modelSelection.model, "gpt-5.5");
      assert.isNotNull(projection.thread.archivedAt);
      assert.isNotNull(projection.thread.deletedAt);
    }),
  );

  it.effect("cascades owned subagent lifecycle without crossing independent threads", () =>
    Effect.gen(function* () {
      const applicationEngine = yield* OrchestrationEngineService;
      const orchestrator = yield* OrchestratorV2;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("runtime-layer-subagent-lifecycle-project");
      const rootThreadId = ThreadId.make("runtime-layer-subagent-lifecycle-root");
      const independentThreadId = ThreadId.make("runtime-layer-subagent-lifecycle-independent");

      yield* applicationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make("runtime-layer-subagent-lifecycle-project-create"),
        projectId,
        title: "Subagent lifecycle project",
        workspaceRoot: "/tmp/runtime-layer-subagent-lifecycle-project",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: "2026-07-09T00:00:00.000Z",
      });

      const createThread = (threadId: ThreadId, title: string) =>
        orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:create:${threadId}`),
          threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        });
      const startRun = (threadId: ThreadId, suffix: string) =>
        orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:message:${suffix}`),
          threadId,
          messageId: MessageId.make(`message:${suffix}`),
          text: `Run ${suffix}`,
          attachments: [],
          modelSelection,
          dispatchMode: { type: "start_immediately" },
        });

      yield* createThread(rootThreadId, "Lifecycle root");
      yield* createThread(independentThreadId, "Independent thread");
      yield* startRun(rootThreadId, "root");
      const rootBeforeDelegate = yield* orchestrator.getThreadProjection(rootThreadId);
      const rootRun = rootBeforeDelegate.runs[0];
      const rootNode = rootBeforeDelegate.nodes.find((node) => node.kind === "root_turn");
      assert.isDefined(rootRun);
      assert.isDefined(rootNode);

      yield* orchestrator.dispatch({
        type: "delegated_task.request",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: CommandId.make("command:delegate:child"),
        parentThreadId: rootThreadId,
        parentRunId: rootRun.id,
        parentNodeId: rootNode.id,
        task: "Create the child result",
        title: "Owned child",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const rootAfterDelegate = yield* orchestrator.getThreadProjection(rootThreadId);
      const childThreadId = rootAfterDelegate.subagents[0]?.childThreadId;
      assert.isNotNull(childThreadId);
      assert.isDefined(childThreadId);

      const childBeforeDelegate = yield* orchestrator.getThreadProjection(childThreadId);
      const childRun = childBeforeDelegate.runs[0];
      const childNode = childBeforeDelegate.nodes.find((node) => node.kind === "root_turn");
      assert.isDefined(childRun);
      assert.isDefined(childNode);
      yield* orchestrator.dispatch({
        type: "delegated_task.request",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: CommandId.make("command:delegate:grandchild"),
        parentThreadId: childThreadId,
        parentRunId: childRun.id,
        parentNodeId: childNode.id,
        task: "Create the grandchild result",
        title: "Owned grandchild",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const childAfterDelegate = yield* orchestrator.getThreadProjection(childThreadId);
      const grandchildThreadId = childAfterDelegate.subagents[0]?.childThreadId;
      assert.isNotNull(grandchildThreadId);
      assert.isDefined(grandchildThreadId);

      yield* orchestrator.dispatch({
        type: "delegated_task.request",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: CommandId.make("command:delegate:deleted-grandchild"),
        parentThreadId: childThreadId,
        parentRunId: childRun.id,
        parentNodeId: childNode.id,
        task: "Create the grandchild that will be deleted directly",
        title: "Deleted grandchild",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const childWithDeletedGrandchild = yield* orchestrator.getThreadProjection(childThreadId);
      const deletedGrandchildTask = childWithDeletedGrandchild.subagents.find(
        (subagent) => subagent.childThreadId !== grandchildThreadId,
      );
      const deletedGrandchildThreadId = deletedGrandchildTask?.childThreadId;
      assert.isDefined(deletedGrandchildTask);
      assert.isNotNull(deletedGrandchildThreadId);
      assert.isDefined(deletedGrandchildThreadId);
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("command:delete:grandchild-branch"),
        threadId: deletedGrandchildThreadId,
      });
      const childAfterGrandchildDelete = yield* orchestrator.getThreadProjection(childThreadId);
      assert.equal(
        childAfterGrandchildDelete.subagents.find(
          (subagent) => subagent.id === deletedGrandchildTask.id,
        )?.status,
        "cancelled",
      );
      assert.equal(
        childAfterGrandchildDelete.nodes.find((node) => node.id === deletedGrandchildTask.id)
          ?.status,
        "cancelled",
      );
      assert.equal(
        childAfterGrandchildDelete.turnItems.find(
          (item) => item.type === "subagent" && item.subagentId === deletedGrandchildTask.id,
        )?.status,
        "cancelled",
      );

      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("command:archive:grandchild"),
        threadId: grandchildThreadId,
      });
      const legacyParentDeletedAt = "2026-07-09T01:00:00.000Z";
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET
          deleted_at = ${legacyParentDeletedAt},
          payload_json = json_set(payload_json, '$.deletedAt', ${legacyParentDeletedAt})
        WHERE thread_id = ${childThreadId}
      `;
      const deletedParentUnarchiveError = yield* orchestrator
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("command:unarchive:deleted-parent-child"),
          threadId: grandchildThreadId,
        })
        .pipe(Effect.flip);
      assert.equal(deletedParentUnarchiveError._tag, "OrchestratorDispatchError");
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET
          deleted_at = NULL,
          payload_json = json_set(payload_json, '$.deletedAt', NULL)
        WHERE thread_id = ${childThreadId}
      `;
      const rootArchive = yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("command:archive:root-subtree"),
        threadId: rootThreadId,
      });

      const archivedRoot = yield* orchestrator.getThreadProjection(rootThreadId);
      const archivedChild = yield* orchestrator.getThreadProjection(childThreadId);
      const archivedGrandchild = yield* orchestrator.getThreadProjection(grandchildThreadId);
      assert.isNotNull(archivedRoot.thread.archivedAt);
      assert.deepEqual(archivedChild.thread.archivedAt, archivedRoot.thread.archivedAt);
      assert.notDeepEqual(archivedGrandchild.thread.archivedAt, archivedRoot.thread.archivedAt);
      assert.equal(archivedRoot.runs[0]?.status, "cancelled");
      assert.equal(archivedChild.runs[0]?.status, "cancelled");
      assert.equal(archivedGrandchild.runs[0]?.status, "cancelled");
      assert.equal(archivedRoot.subagents[0]?.status, "cancelled");
      assert.equal(
        archivedRoot.nodes.find((node) => node.kind === "subagent")?.status,
        "cancelled",
      );
      assert.equal(
        archivedRoot.turnItems.find((item) => item.type === "subagent")?.status,
        "cancelled",
      );
      assert.equal(archivedChild.subagents[0]?.status, "cancelled");
      assert.deepEqual(
        rootArchive.storedEvents
          .filter((stored) => stored.event.type === "thread.archived")
          .map((stored) => stored.event.threadId)
          .toSorted(),
        [childThreadId, rootThreadId].toSorted(),
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.isFalse(
        (yield* orchestrator.getThreadProjection(rootThreadId)).contextTransfers.some(
          (transfer) => transfer.type === "subagent_result",
        ),
      );

      const childUnarchiveError = yield* orchestrator
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("command:unarchive:managed-child"),
          threadId: childThreadId,
        })
        .pipe(Effect.flip);
      assert.equal(childUnarchiveError._tag, "OrchestratorDispatchError");

      const grandchildUnarchiveError = yield* orchestrator
        .dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make("command:unarchive:independently-archived-grandchild"),
          threadId: grandchildThreadId,
        })
        .pipe(Effect.flip);
      assert.equal(grandchildUnarchiveError._tag, "OrchestratorDispatchError");

      yield* orchestrator.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make("command:unarchive:root-subtree"),
        threadId: rootThreadId,
      });
      assert.isNull((yield* orchestrator.getThreadProjection(rootThreadId)).thread.archivedAt);
      assert.isNull((yield* orchestrator.getThreadProjection(childThreadId)).thread.archivedAt);
      assert.isNotNull(
        (yield* orchestrator.getThreadProjection(grandchildThreadId)).thread.archivedAt,
      );
      yield* startRun(childThreadId, "child-after-unarchive");
      assert.equal(
        (yield* orchestrator.getThreadProjection(childThreadId)).runs.at(-1)?.status,
        "starting",
      );

      const deletion = yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("command:delete:root-subtree"),
        threadId: rootThreadId,
      });
      assert.deepEqual(
        deletion.storedEvents
          .filter((stored) => stored.event.type === "thread.deleted")
          .map((stored) => stored.event.threadId)
          .toSorted(),
        [rootThreadId, childThreadId, grandchildThreadId].toSorted(),
      );
      for (const threadId of [rootThreadId, childThreadId, grandchildThreadId]) {
        assert.isNotNull((yield* orchestrator.getThreadProjection(threadId)).thread.deletedAt);
      }
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.isFalse(
        (yield* orchestrator.getThreadProjection(rootThreadId)).contextTransfers.some(
          (transfer) => transfer.type === "subagent_result",
        ),
      );
      const shell = yield* orchestrator.getShellSnapshot();
      assert.include(
        [...shell.threads, ...shell.archivedThreads].map((thread) => thread.id),
        independentThreadId,
      );
      assert.notInclude(
        [...shell.threads, ...shell.archivedThreads].map((thread) => thread.id),
        rootThreadId,
      );
    }).pipe(Effect.provide(SharedApplicationDataPlaneTestLayer)),
  );

  it.effect("persists rejected command receipts across retries", () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorV2;
      const command = {
        type: "thread.archive" as const,
        commandId: CommandId.make("runtime-layer-rejected-command"),
        threadId: ThreadId.make("runtime-layer-missing-thread"),
      };

      const first = yield* orchestrator.dispatch(command).pipe(Effect.flip);
      const retry = yield* orchestrator.dispatch(command).pipe(Effect.flip);

      assert.equal(first._tag, "OrchestratorProjectionError");
      assert.equal(retry._tag, "OrchestratorCommandPreviouslyRejectedError");
    }),
  );
});

it.layer(SharedApplicationDataPlaneTestLayer)("pending provider interruption", (it) => {
  it.effect("interrupts a pending provider start without launching provider work", () =>
    Effect.gen(function* () {
      const applicationEngine = yield* OrchestrationEngineService;
      const orchestrator = yield* OrchestratorV2;
      const threadManagement = yield* ThreadManagementService;
      const effectWorker = yield* OrchestrationEffectWorkerV2;
      const projectId = ProjectId.make("runtime-layer-pending-interrupt-project");
      const threadId = ThreadId.make("runtime-layer-pending-interrupt-thread");

      yield* applicationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.make("runtime-layer-pending-interrupt-project-create"),
        projectId,
        title: "Pending interrupt project",
        workspaceRoot: "/tmp/runtime-layer-pending-interrupt-project",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: "2026-06-22T00:00:00.000Z",
      });
      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("runtime-layer-pending-interrupt-create"),
        threadId,
        projectId,
        title: "Pending interrupt",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("runtime-layer-pending-interrupt-message"),
        threadId,
        messageId: MessageId.make("runtime-layer-pending-interrupt-message"),
        text: "Do not reach the provider.",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      const starting = yield* orchestrator.getThreadProjection(threadId);
      const run = starting.runs[0];
      assert.isDefined(run);
      assert.equal(run.status, "starting");

      const interrupt = yield* threadManagement.interruptThread({
        projectId,
        commandId: CommandId.make("runtime-layer-pending-interrupt-command"),
        threadId,
        runId: run.id,
        reason: "Cancelled before provider start",
      });
      assert.equal(interrupt.type, "interrupt_requested");

      const interrupted = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(interrupted.runs[0]?.status, "interrupted");
      assert.equal(interrupted.attempts[0]?.status, "interrupted");
      assert.equal(
        interrupted.nodes.find((node) => node.kind === "root_turn")?.status,
        "interrupted",
      );
      assert.deepEqual(
        interrupted.turnItems.filter((item) => item.runId === run.id).map((item) => item.type),
        ["user_message", "run_interrupt_request", "run_interrupt_result"],
      );
      assert.deepEqual(interrupted.providerTurns, []);
      assert.isFalse(yield* effectWorker.runOnce);
    }),
  );
});

it.layer(SharedApplicationDataPlaneTestLayer)("shared application data plane", (it) => {
  it.effect("orders retained project transactions and V2 thread transactions in one source", () =>
    Effect.gen(function* () {
      const applicationEngine = yield* OrchestrationEngineService;
      const applicationEvents = yield* OrchestrationEventStore;
      const orchestrator = yield* OrchestratorV2;
      const projectionSnapshot = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("runtime-layer-shared-project");
      const threadId = ThreadId.make("runtime-layer-shared-thread");
      const projectCommand = {
        type: "project.create" as const,
        commandId: CommandId.make("runtime-layer-shared-project-create"),
        projectId,
        title: "Shared application source",
        workspaceRoot: "/tmp/runtime-layer-shared-project",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: "2026-06-20T00:00:00.000Z",
      };

      const projectResult = yield* applicationEngine.dispatch(projectCommand);
      const projectRetry = yield* applicationEngine.dispatch(projectCommand);
      assert.equal(projectRetry.sequence, projectResult.sequence);

      const delivered = yield* Queue.unbounded<ApplicationStoredEvent>();
      yield* applicationEvents.streamApplicationEvents().pipe(
        Stream.take(2),
        Stream.runForEach((event) => Queue.offer(delivered, event)),
        Effect.forkScoped,
      );

      const projectEvent = yield* Queue.take(delivered);
      assert.equal(projectEvent.sequence, projectResult.sequence);

      const threadResult = yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("runtime-layer-shared-thread-create"),
        threadId,
        projectId,
        title: "Shared thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      const threadEvent = yield* Queue.take(delivered);

      assert.equal(threadEvent.sequence, threadResult.sequence);
      assert.isAbove(threadEvent.sequence, projectEvent.sequence);
      assert.isTrue("aggregateKind" in projectEvent);
      assert.isTrue("event" in threadEvent);
      assert.equal((yield* projectionSnapshot.getProjectShellById(projectId))._tag, "Some");

      const retainedReceipts = yield* sql<{
        readonly aggregate_kind: string;
        readonly aggregate_id: string;
      }>`
        SELECT aggregate_kind, aggregate_id
        FROM orchestration_command_receipts
        ORDER BY result_sequence ASC
      `;
      assert.deepEqual(retainedReceipts, [
        { aggregate_kind: "project", aggregate_id: projectId },
        { aggregate_kind: "thread", aggregate_id: threadId },
      ]);

      const retiredWrites = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_v2_events) +
          (SELECT COUNT(*) FROM orchestration_v2_command_receipts) AS count
      `;
      assert.equal(retiredWrites[0]?.count, 0);
    }),
  );
});
