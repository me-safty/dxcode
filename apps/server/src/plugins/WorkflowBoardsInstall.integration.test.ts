import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type AuthScope,
  type PluginCapability,
  PluginId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  pluginOperateScope,
  pluginReadScope,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  OWNED_INDEXES,
  OWNED_TABLES,
} from "../../../../fixtures/workflow-boards/server/migrations/renameMap.ts";
import {
  WORKFLOW_WS_METHODS,
  type BoardSnapshot,
  type BoardStreamItem,
  type WorkflowBoardDigest,
  type WorkflowBoardMetrics,
  type WorkflowBoardVersionSummary,
  type WorkflowGetBoardDefinitionResult,
  type WorkflowGetBoardVersionResult,
  type WorkflowNeedsAttentionTicketView,
  type WorkflowSaveBoardDefinitionResult,
  type WorkflowTicketDetailView,
} from "../../../../fixtures/workflow-boards/contracts/workflow.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import * as ProjectionThreadActivities from "../persistence/Services/ProjectionThreadActivities.ts";
import * as ProjectionThreadMessages from "../persistence/Services/ProjectionThreadMessages.ts";
import * as ProjectionTurns from "../persistence/Services/ProjectionTurns.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ServerLifecycleEvents from "../serverLifecycleEvents.ts";
import { PluginHttpClientTransportService } from "./capabilities/HttpClientCapability.ts";
import { OutboundUrlError, OutboundUrlLookup } from "./OutboundUrlValidator.ts";
import * as PluginCatalogModule from "./PluginCatalog.ts";
import * as PluginHostModule from "./PluginHost.ts";
import * as PluginHttpRegistry from "./PluginHttpRegistry.ts";
import * as PluginInstallerModule from "./PluginInstaller.ts";
import * as PluginLockfileStoreLayer from "./PluginLockfileStore.ts";
import * as PluginManagementRpcHandlersModule from "./PluginManagementRpcHandlers.ts";
import * as PluginMarketplaceModule from "./PluginMarketplace.ts";
import * as PluginMigrator from "./PluginMigrator.ts";
import * as PluginModuleLoaderLayer from "./PluginModuleLoader.ts";
import * as PluginRpcDispatcherModule from "./PluginRpcDispatcher.ts";
import * as PluginRuntimeRegistryLayer from "./PluginRuntimeRegistry.ts";

const pluginId = PluginId.make("workflow-boards");
const WORKSPACE_ROOT_ENV = "T3_WORKFLOW_BOARDS_WORKSPACE_ROOT";
const fixtureRoot = decodeURIComponent(
  new URL("../../../../fixtures/workflow-boards", import.meta.url).pathname,
);
const testProjectId = ProjectId.make("workflow-boards-project");
const testAgentInstanceId = ProviderInstanceId.make("fixture-agent");
const testModel = "fixture-model";

const projectShell = () => ({
  id: testProjectId,
  title: "Workflow Boards Project",
  workspaceRoot: process.env[WORKSPACE_ROOT_ENV] ?? process.cwd(),
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
});

const fixtureProvider: ServerProvider = {
  instanceId: testAgentInstanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-07-03T00:00:00.000Z",
  models: [{ slug: testModel, name: "Fixture Model", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};

const LEGACY_TABLE_NAMES = [
  "workflow_events",
  "projection_board",
  "projection_ticket",
  "projection_pipeline_run",
  "projection_step_run",
  "projection_ticket_message",
  "projection_ticket_dependency",
  "worktree_lease",
  "workflow_dispatch_outbox",
  "workflow_setup_run",
  "workflow_project_trust",
  "workflow_script_run",
  "workflow_board_version",
  "workflow_board_webhook",
  "workflow_webhook_delivery",
  "workflow_pr_state",
  "workflow_pr_observation",
  "workflow_notification_outbox",
  "work_source_connection",
  "work_source_mapping",
  "work_source_state",
  "workflow_outbound_connection",
  "workflow_outbound_delivery",
  "workflow_board_proposal",
  "workflow_agent_session",
] as const;

// Exact column count per ported table (the faithful baseline). A dropped/added
// column changes the count and fails the shape guard. dispatch_outbox = 18 (13
// base + durable message_id + 4 folded ALTER columns); step_run = 20; ticket = 19.
const EXPECTED_TABLE_COLUMN_COUNTS: Readonly<Record<string, number>> = {
  p_workflow_boards_agent_session: 6,
  p_workflow_boards_board_proposal: 12,
  p_workflow_boards_board_version: 6,
  p_workflow_boards_board_webhook: 4,
  p_workflow_boards_dispatch_outbox: 18,
  p_workflow_boards_events: 7,
  p_workflow_boards_outbound_connection: 5,
  p_workflow_boards_outbound_delivery: 13,
  p_workflow_boards_pr_observation: 9,
  p_workflow_boards_pr_state: 12,
  p_workflow_boards_project_trust: 2,
  p_workflow_boards_projection_board: 6,
  p_workflow_boards_projection_pipeline_run: 7,
  p_workflow_boards_projection_step_run: 20,
  p_workflow_boards_projection_ticket: 19,
  p_workflow_boards_projection_ticket_dependency: 2,
  p_workflow_boards_projection_ticket_message: 8,
  p_workflow_boards_script_run: 10,
  p_workflow_boards_setup_run: 7,
  p_workflow_boards_webhook_delivery: 3,
  p_workflow_boards_work_source_connection: 8,
  p_workflow_boards_work_source_mapping: 13,
  p_workflow_boards_work_source_state: 7,
  p_workflow_boards_worktree_lease: 6,
};

class WorkflowBoardsFixtureBuildError extends Data.TaggedError("WorkflowBoardsFixtureBuildError")<{
  readonly stdout: string;
  readonly stderr: string;
}> {}

const unexpectedCapabilityUse = () =>
  Effect.die(new Error("unexpected capability use in workflow-boards fixture test"));

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 404 }))),
  ),
);
const TestOutboundLookupLive = Layer.succeed(OutboundUrlLookup, (host: string) =>
  host === "fixture.test"
    ? Effect.succeed([{ address: "140.82.112.3", family: 4 as const }])
    : Effect.fail(new OutboundUrlError({ reason: `unexpected lookup ${host}` })),
);
const TestPluginHttpClientTransportLive = Layer.succeed(
  PluginHttpClientTransportService,
  (request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        HttpClientRequest.make(request.method as "GET")(request.url.toString()),
        new Response("hello http", { status: 200 }),
      ),
    ),
);

const PluginRuntimeRegistryLayerLive = PluginRuntimeRegistryLayer.layer;
const PluginHttpRegistryLayerLive = PluginHttpRegistry.layer;
const PluginLockfileStoreLayerLive = PluginLockfileStoreLayer.layer;
const PluginHostCapabilityDepsLayerLive = Layer.mergeAll(
  Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: unexpectedCapabilityUse,
    set: unexpectedCapabilityUse,
    create: unexpectedCapabilityUse,
    getOrCreateRandom: unexpectedCapabilityUse,
    remove: unexpectedCapabilityUse,
  }),
  Layer.mock(ServerEnvironment.ServerEnvironment)({
    getEnvironmentId: unexpectedCapabilityUse(),
    getDescriptor: unexpectedCapabilityUse(),
  }),
  Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
    readEvents: () => Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 1 }),
    streamDomainEvents: Stream.empty,
  }),
  Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getCommandReadModel: unexpectedCapabilityUse,
    getSnapshot: unexpectedCapabilityUse,
    getShellSnapshot: () =>
      Effect.sync(() => ({
        snapshotSequence: 1,
        updatedAt: "2026-07-03T00:00:00.000Z",
        projects: [
          {
            ...projectShell(),
          },
        ],
        threads: [],
      })),
    getArchivedShellSnapshot: unexpectedCapabilityUse,
    getSnapshotSequence: () => Effect.succeed(1 as never),
    getCounts: unexpectedCapabilityUse,
    getActiveProjectByWorkspaceRoot: unexpectedCapabilityUse,
    getProjectShellById: (projectId) =>
      Effect.succeed(projectId === testProjectId ? Option.some(projectShell()) : Option.none()),
    getFirstActiveThreadIdByProjectId: unexpectedCapabilityUse,
    getThreadOwnerById: () => Effect.succeed(Option.some(`plugin:${pluginId}` as const)),
    getThreadCheckpointContext: unexpectedCapabilityUse,
    getFullThreadDiffContext: unexpectedCapabilityUse,
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(ProjectionTurns.ProjectionTurnRepository)({
    upsertByTurnId: unexpectedCapabilityUse,
    replacePendingTurnStart: unexpectedCapabilityUse,
    getPendingTurnStartByThreadId: unexpectedCapabilityUse,
    deletePendingTurnStartByThreadId: unexpectedCapabilityUse,
    listByThreadId: () => Effect.succeed([]),
    getByTurnId: ({ threadId, turnId }) =>
      Effect.succeed(
        Option.some({
          threadId,
          turnId,
          pendingMessageId: null,
          sourceProposedPlanThreadId: null,
          sourceProposedPlanId: null,
          assistantMessageId: null,
          state: "completed" as const,
          requestedAt: "2026-07-03T00:00:00.000Z",
          startedAt: "2026-07-03T00:00:00.000Z",
          completedAt: "2026-07-03T00:00:00.000Z",
          checkpointTurnCount: null,
          checkpointRef: null,
          checkpointStatus: null,
          checkpointFiles: [],
        }),
      ),
    clearCheckpointTurnConflict: unexpectedCapabilityUse,
    deleteByThreadId: unexpectedCapabilityUse,
  }),
  Layer.mock(ProjectionThreadMessages.ProjectionThreadMessageRepository)({
    upsert: unexpectedCapabilityUse,
    getByMessageId: () => Effect.succeed(Option.none()),
    listByThreadId: () => Effect.succeed([]),
    deleteByThreadId: unexpectedCapabilityUse,
  }),
  Layer.mock(ProjectionThreadActivities.ProjectionThreadActivityRepository)({
    upsert: unexpectedCapabilityUse,
    listByThreadId: () => Effect.succeed([]),
    deleteByThreadId: unexpectedCapabilityUse,
  }),
  Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
    getInstance: unexpectedCapabilityUse,
    listInstances: Effect.succeed([
      { snapshot: { getSnapshot: Effect.succeed(fixtureProvider) } },
    ] as never),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: unexpectedCapabilityUse(),
  }),
  Layer.mock(GitVcsDriver.GitVcsDriver)({
    execute: unexpectedCapabilityUse,
    status: unexpectedCapabilityUse,
    statusDetails: unexpectedCapabilityUse,
    statusDetailsLocal: unexpectedCapabilityUse,
    statusDetailsRemote: unexpectedCapabilityUse,
    prepareCommitContext: unexpectedCapabilityUse,
    commit: unexpectedCapabilityUse,
    pushCurrentBranch: unexpectedCapabilityUse,
    readRangeContext: unexpectedCapabilityUse,
    getReviewDiffPreview: unexpectedCapabilityUse,
    readConfigValue: unexpectedCapabilityUse,
    listRefs: unexpectedCapabilityUse,
    pullCurrentBranch: unexpectedCapabilityUse,
    createWorktree: unexpectedCapabilityUse,
    fetchPullRequestBranch: unexpectedCapabilityUse,
    ensureRemote: unexpectedCapabilityUse,
    resolvePrimaryRemoteName: unexpectedCapabilityUse,
    fetchRemote: unexpectedCapabilityUse,
    resolveRemoteTrackingCommit: unexpectedCapabilityUse,
    fetchRemoteBranch: unexpectedCapabilityUse,
    fetchRemoteTrackingBranch: unexpectedCapabilityUse,
    setBranchUpstream: unexpectedCapabilityUse,
    removeWorktree: unexpectedCapabilityUse,
    renameBranch: unexpectedCapabilityUse,
    createRef: unexpectedCapabilityUse,
    switchRef: unexpectedCapabilityUse,
    initRepo: unexpectedCapabilityUse,
    listLocalBranchNames: unexpectedCapabilityUse,
  }),
  Layer.mock(CheckpointStore.CheckpointStore)({
    isGitRepository: unexpectedCapabilityUse,
    captureCheckpoint: unexpectedCapabilityUse,
    hasCheckpointRef: unexpectedCapabilityUse,
    restoreCheckpoint: unexpectedCapabilityUse,
    diffCheckpoints: unexpectedCapabilityUse,
    deleteCheckpointRefs: unexpectedCapabilityUse,
  }),
  Layer.mock(TextGeneration.TextGeneration)({
    generateCommitMessage: unexpectedCapabilityUse,
    generatePrContent: unexpectedCapabilityUse,
    generateBranchName: unexpectedCapabilityUse,
    generateThreadTitle: unexpectedCapabilityUse,
  }),
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    get: unexpectedCapabilityUse,
    resolveHandle: unexpectedCapabilityUse,
    resolve: unexpectedCapabilityUse,
    discover: unexpectedCapabilityUse(),
  }),
  Layer.mock(GitHubCli.GitHubCli)({
    execute: unexpectedCapabilityUse,
    listOpenPullRequests: unexpectedCapabilityUse,
    getPullRequest: unexpectedCapabilityUse,
    getRepositoryCloneUrls: unexpectedCapabilityUse,
    createRepository: unexpectedCapabilityUse,
    createPullRequest: unexpectedCapabilityUse,
    mergePullRequest: unexpectedCapabilityUse,
    getPullRequestDetail: unexpectedCapabilityUse,
    listPullRequestChecks: unexpectedCapabilityUse,
    listPullRequestReviews: unexpectedCapabilityUse,
    listPullRequestReviewComments: unexpectedCapabilityUse,
    getDefaultBranch: unexpectedCapabilityUse,
    checkoutPullRequest: unexpectedCapabilityUse,
  }),
  Layer.mock(TerminalManager.TerminalManager)({
    open: unexpectedCapabilityUse,
    attachStream: unexpectedCapabilityUse,
    write: unexpectedCapabilityUse,
    resize: unexpectedCapabilityUse,
    clear: unexpectedCapabilityUse,
    restart: unexpectedCapabilityUse,
    close: unexpectedCapabilityUse,
    subscribe: unexpectedCapabilityUse,
    subscribeMetadata: unexpectedCapabilityUse,
  }),
  TestOutboundLookupLive,
  TestPluginHttpClientTransportLive,
);

const PluginHostLayerLive = PluginHostModule.layer.pipe(
  Layer.provideMerge(PluginLockfileStoreLayerLive),
  Layer.provideMerge(PluginModuleLoaderLayer.layer),
  Layer.provideMerge(PluginMigrator.layer),
  Layer.provideMerge(PluginRuntimeRegistryLayerLive),
  Layer.provideMerge(PluginHttpRegistryLayerLive),
  Layer.provideMerge(ServerLifecycleEvents.layer),
  Layer.provideMerge(PluginHostCapabilityDepsLayerLive),
);
const PluginRpcDispatcherLayerLive = PluginRpcDispatcherModule.layer.pipe(
  Layer.provideMerge(PluginRuntimeRegistryLayerLive),
);
const PluginCatalogLayerLive = PluginCatalogModule.layer.pipe(
  Layer.provideMerge(PluginLockfileStoreLayerLive),
  Layer.provideMerge(PluginRuntimeRegistryLayerLive),
);
const PluginMarketplaceLayerLive = PluginMarketplaceModule.layer;
const PluginInstallerLayerLive = PluginInstallerModule.layer.pipe(
  Layer.provideMerge(PluginLockfileStoreLayerLive),
  Layer.provideMerge(PluginMarketplaceLayerLive),
  Layer.provideMerge(PluginHostLayerLive),
  Layer.provideMerge(PluginCatalogLayerLive),
);
const PluginManagementRpcHandlersLayerLive = PluginManagementRpcHandlersModule.layer.pipe(
  Layer.provideMerge(PluginLockfileStoreLayerLive),
  Layer.provideMerge(PluginMarketplaceLayerLive),
  Layer.provideMerge(PluginInstallerLayerLive),
);
const PluginLayerLive = Layer.mergeAll(
  PluginHostLayerLive,
  PluginRpcDispatcherLayerLive,
  PluginCatalogLayerLive,
  PluginMarketplaceLayerLive,
  PluginInstallerLayerLive,
  PluginManagementRpcHandlersLayerLive,
  PluginHttpRegistryLayerLive,
  PluginLockfileStoreLayerLive,
);

const testLayer = PluginLayerLive.pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-workflow-boards-fixture-" }),
  ),
  Layer.provideMerge(TestHttpClientLive),
  Layer.provideMerge(TestClock.layer()),
  Layer.provideMerge(NodeServices.layer),
);

const layer = it.layer(testLayer);

const session = (scopes: ReadonlyArray<AuthScope>) => ({ scopes });

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

function buildFixture(outDir: string) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("pnpm", ["--dir", fixtureRoot, "run", "build", "--", "--out-dir", outDir], {
        cwd: fixtureRoot,
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectText(child.stdout),
        collectText(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) {
      return yield* new WorkflowBoardsFixtureBuildError({ stdout, stderr });
    }
  }).pipe(Effect.scoped);
}

function linkHostPluginExternals(pluginsDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const nodeModules = path.join(pluginsDir, "node_modules");
    yield* fs.makeDirectory(path.join(nodeModules, "@t3tools"), { recursive: true });
    const links = [
      {
        from: path.resolve(import.meta.dirname, "../../../../packages/plugin-sdk"),
        to: path.join(nodeModules, "@t3tools/plugin-sdk"),
      },
      {
        from: path.resolve(import.meta.dirname, "../../node_modules/effect"),
        to: path.join(nodeModules, "effect"),
      },
    ];
    for (const link of links) {
      yield* fs.remove(link.to, { force: true, recursive: true });
      yield* fs.symlink(link.from, link.to);
    }
  });
}

const withPluginDev = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => ({
      pluginDev: process.env.T3_PLUGIN_DEV,
      healthyDelay: process.env.T3_PLUGIN_HOST_HEALTHY_DELAY_MS,
      workspaceRoot: process.env[WORKSPACE_ROOT_ENV],
    })),
    () =>
      Effect.sync(() => {
        process.env.T3_PLUGIN_DEV = "1";
        process.env.T3_PLUGIN_HOST_HEALTHY_DELAY_MS = "0";
      }).pipe(Effect.andThen(effect)),
    (previous) =>
      Effect.sync(() => {
        if (previous.pluginDev === undefined) {
          delete process.env.T3_PLUGIN_DEV;
        } else {
          process.env.T3_PLUGIN_DEV = previous.pluginDev;
        }
        if (previous.healthyDelay === undefined) {
          delete process.env.T3_PLUGIN_HOST_HEALTHY_DELAY_MS;
        } else {
          process.env.T3_PLUGIN_HOST_HEALTHY_DELAY_MS = previous.healthyDelay;
        }
        if (previous.workspaceRoot === undefined) {
          delete process.env[WORKSPACE_ROOT_ENV];
        } else {
          process.env[WORKSPACE_ROOT_ENV] = previous.workspaceRoot;
        }
      }),
  );

layer("workflow-boards fixture plugin", (it) => {
  it.effect("installs, activates, runs migrations, and creates namespaced schema", () =>
    withPluginDev(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sql = yield* SqlClient.SqlClient;
          const handlers = yield* PluginManagementRpcHandlersModule.PluginManagementRpcHandlers;
          const catalog = yield* PluginCatalogModule.PluginCatalog;
          const dispatcher = yield* PluginRpcDispatcherModule.PluginRpcDispatcher;
          const httpRegistry = yield* PluginHttpRegistry.PluginHttpRegistry;
          const outDir = yield* fs.makeTempDirectoryScoped({
            prefix: "workflow-boards-fixture-",
          });
          const workspaceRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "workflow-boards-workspace-",
          });
          const config = yield* ServerConfig.ServerConfig;
          process.env[WORKSPACE_ROOT_ENV] = workspaceRoot;

          yield* buildFixture(outDir);
          yield* linkHostPluginExternals(config.pluginsDir);
          yield* runMigrations({ toMigrationInclusive: 34 });

          const marketplaceUrl = new URL(`file://${path.join(outDir, "marketplace.json")}`).href;
          const source = yield* handlers.addSource({ url: marketplaceUrl });
          const catalogResult = yield* handlers.catalog({ sourceId: source.source.id });
          assert.equal(catalogResult.entries[0]?.id, pluginId);

          const staged = yield* handlers.beginInstall({
            sourceId: source.source.id,
            pluginId,
            version: "0.1.0",
          });
          const expectedCapabilities: PluginCapability[] = [
            "database",
            "filesystem",
            "http",
            "agents",
            "projections.read",
            "vcs",
            "terminals",
            "sourceControl",
            "environments.read",
          ];
          assert.equal(staged.manifest.id, pluginId);
          assert.deepEqual(
            Object.keys(staged.capabilityDescriptions).sort(),
            [...expectedCapabilities].sort(),
          );

          const confirmed = yield* handlers.confirmInstall(staged.stageToken);
          assert.equal(confirmed.plugin.id, pluginId);

          const installed = yield* catalog.list;
          assert.deepInclude(
            installed.map((plugin) => ({
              id: plugin.id,
              state: plugin.state,
              hasWeb: plugin.hasWeb,
              capabilities: [...plugin.capabilities].sort(),
              lastError: plugin.lastError,
            })),
            {
              id: pluginId,
              state: "active",
              hasWeb: false,
              capabilities: [...expectedCapabilities].sort(),
              lastError: null,
            },
          );

          const rpcSession = session([pluginReadScope(pluginId), pluginOperateScope(pluginId)]);
          const created = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.createBoard,
            {
              projectId: testProjectId,
              name: "Acceptance Board",
              agent: { instance: testAgentInstanceId, model: testModel },
            },
            rpcSession,
          )) as { readonly boardId: string; readonly snapshot: BoardSnapshot };
          assert.equal(created.snapshot.board.name, "Acceptance Board");
          assert.deepEqual(
            created.snapshot.board.lanes.slice(0, 3).map((lane) => lane.key),
            ["backlog", "planning", "specifying"],
          );

          const initialDefinition = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardDefinition,
            { boardId: created.boardId },
            rpcSession,
          )) as WorkflowGetBoardDefinitionResult;
          assert.equal(initialDefinition.definition.name, "Acceptance Board");

          const renamedDefinition = {
            ...initialDefinition.definition,
            name: "Acceptance Board Saved",
          };
          const savedDefinition = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.saveBoardDefinition,
            {
              boardId: created.boardId,
              definition: renamedDefinition,
              expectedVersionHash: initialDefinition.versionHash,
              source: "save",
            },
            rpcSession,
          )) as WorkflowSaveBoardDefinitionResult;
          assert.isTrue(savedDefinition.ok);
          if (savedDefinition.ok) {
            assert.equal(savedDefinition.definition.name, "Acceptance Board Saved");
            assert.equal(savedDefinition.snapshot.board.name, "Acceptance Board Saved");
            assert.notEqual(savedDefinition.versionHash, initialDefinition.versionHash);
          }

          const savedVersionHash = savedDefinition.ok
            ? savedDefinition.versionHash
            : initialDefinition.versionHash;
          const savedDefinitionRead = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardDefinition,
            { boardId: created.boardId },
            rpcSession,
          )) as WorkflowGetBoardDefinitionResult;
          assert.equal(savedDefinitionRead.definition.name, "Acceptance Board Saved");
          assert.equal(savedDefinitionRead.versionHash, savedVersionHash);

          const versions = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.listBoardVersions,
            { boardId: created.boardId },
            rpcSession,
          )) as WorkflowBoardVersionSummary[];
          assert.isAtLeast(versions.length, 2);
          assert.equal(versions[0]?.versionHash, savedVersionHash);
          assert.equal(versions[0]?.isCurrent, true);

          const currentVersion = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardVersion,
            { boardId: created.boardId, versionId: versions[0]?.versionId ?? -1 },
            rpcSession,
          )) as WorkflowGetBoardVersionResult;
          assert.equal(currentVersion.versionHash, savedVersionHash);
          assert.equal(currentVersion.definition.name, "Acceptance Board Saved");

          const staleSave = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.saveBoardDefinition,
            {
              boardId: created.boardId,
              definition: { ...renamedDefinition, name: "Should Conflict" },
              expectedVersionHash: initialDefinition.versionHash,
            },
            rpcSession,
          )) as WorkflowSaveBoardDefinitionResult;
          assert.isFalse(staleSave.ok);
          if (!staleSave.ok && "conflict" in staleSave) {
            assert.equal(staleSave.conflict, true);
            assert.equal(staleSave.currentVersionHash, savedVersionHash);
          } else {
            assert.fail("expected stale save to return an optimistic-concurrency conflict");
          }

          const board = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoard,
            { boardId: created.boardId },
            rpcSession,
          )) as BoardSnapshot;
          assert.equal(board.board.boardId, created.boardId);
          assert.equal(board.board.name, "Acceptance Board Saved");
          assert.equal(board.tickets.length, 0);

          const createdTicket = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.createTicket,
            {
              boardId: created.boardId,
              title: "Drive the board",
              description: "Acceptance ticket",
              initialLane: "backlog",
            },
            rpcSession,
          )) as { readonly ticketId: string };
          assert.isString(createdTicket.ticketId);

          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.editTicket,
            {
              ticketId: createdTicket.ticketId,
              title: "Drive the saved board",
              description: "Edited acceptance ticket",
              tokenBudget: 42,
            },
            rpcSession,
          );
          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.postTicketMessage,
            { ticketId: createdTicket.ticketId, text: "Manual note" },
            rpcSession,
          );
          const editedDetail = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getTicketDetail,
            { ticketId: createdTicket.ticketId },
            rpcSession,
          )) as WorkflowTicketDetailView;
          assert.equal(editedDetail.ticket.title, "Drive the saved board");
          assert.equal(editedDetail.ticket.description, "Edited acceptance ticket");
          assert.equal(editedDetail.ticket.tokenBudget, 42);
          const postedMessage = editedDetail.messages.find((message) => message.body === "Manual note");
          assert.isDefined(postedMessage);
          if (postedMessage === undefined) {
            return yield* Effect.die("posted workflow ticket message was not projected");
          }
          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.editTicketMessage,
            {
              ticketId: createdTicket.ticketId,
              messageId: postedMessage.messageId,
              body: "Manual note edited",
            },
            rpcSession,
          );
          const messageDetail = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getTicketDetail,
            { ticketId: createdTicket.ticketId },
            rpcSession,
          )) as WorkflowTicketDetailView;
          assert.isTrue(
            messageDetail.messages.some((message) => message.body === "Manual note edited"),
          );

          const streamItems: BoardStreamItem[] = [];
          const snapshotReceived = yield* Deferred.make<void>();
          const streamFiber = yield* dispatcher
            .subscribe(
              pluginId,
              WORKFLOW_WS_METHODS.subscribeBoard,
              { boardId: created.boardId },
              rpcSession,
            )
            .pipe(
              Stream.take(2),
              Stream.tap((item) =>
                Effect.sync(() => {
                  streamItems.push(item as BoardStreamItem);
                }).pipe(
                  Effect.andThen(
                    (item as BoardStreamItem).kind === "snapshot"
                      ? Deferred.succeed(snapshotReceived, undefined).pipe(Effect.ignore)
                      : Effect.void,
                  ),
                ),
              ),
              Stream.runDrain,
              Effect.forkScoped,
            );
          yield* Deferred.await(snapshotReceived);

          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.moveTicket,
            { ticketId: createdTicket.ticketId, toLane: "planning" },
            rpcSession,
          );
          yield* Fiber.join(streamFiber);
          assert.equal(streamItems[0]?.kind, "snapshot");
          if (streamItems[0]?.kind === "snapshot") {
            // The subscribe snapshot reflects the created ticket (read model wrote it).
            assert.equal(streamItems[0].snapshot.tickets.length, 1);
            assert.equal(streamItems[0].snapshot.tickets[0]?.ticketId, createdTicket.ticketId);
          }
          assert.equal(streamItems[1]?.kind, "ticket");
          if (streamItems[1]?.kind === "ticket") {
            // The post-commit PubSub published the moveTicket transition.
            assert.equal(streamItems[1].ticket.ticketId, createdTicket.ticketId);
            assert.equal(streamItems[1].ticket.currentLaneKey, "planning");
          }

          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.runLane,
            { ticketId: createdTicket.ticketId },
            rpcSession,
          );

          const detail = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getTicketDetail,
            { ticketId: createdTicket.ticketId },
            rpcSession,
          )) as WorkflowTicketDetailView;
          assert.equal(detail.ticket.ticketId, createdTicket.ticketId);
          // runLane executed the "planning" lane pipeline: the ticket is in that
          // lane and the engine created at least one step run for it.
          assert.equal(detail.ticket.currentLaneKey, "planning");
          assert.isAtLeast(detail.steps.length, 1);

          const digest = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardDigest,
            { boardId: created.boardId, windowHours: 999 },
            rpcSession,
          )) as WorkflowBoardDigest;
          assert.equal(digest.windowHours, 168);
          assert.isAtLeast(digest.createdCount, 1);

          const metrics = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardMetrics,
            { boardId: created.boardId, windowDays: 2 },
            rpcSession,
          )) as WorkflowBoardMetrics;
          assert.equal(metrics.windowDays, 7);
          assert.isAtLeast(metrics.throughput.created, 1);

          const needsAttention = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.listNeedsAttentionTickets,
            {},
            rpcSession,
          )) as WorkflowNeedsAttentionTicketView[];
          assert.isArray(needsAttention);

          // --- renameBoard + deleteBoard on a throwaway board (the delete cascade
          // is the highest-blast-radius handler; assert it actually removes the
          // board's owned rows, not just that the call succeeds).
          const disposable = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.createBoard,
            {
              projectId: testProjectId,
              name: "Disposable Board",
              agent: { instance: testAgentInstanceId, model: testModel },
            },
            rpcSession,
          )) as { readonly boardId: string; readonly snapshot: BoardSnapshot };

          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.renameBoard,
            { boardId: disposable.boardId, name: "Renamed Board" },
            rpcSession,
          );
          const renamed = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoard,
            { boardId: disposable.boardId },
            rpcSession,
          )) as BoardSnapshot;
          assert.equal(renamed.board.name, "Renamed Board");

          const disposableDefinition = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getBoardDefinition,
            { boardId: disposable.boardId },
            rpcSession,
          )) as WorkflowGetBoardDefinitionResult;
          const webhookDefinition = {
            ...disposableDefinition.definition,
            lanes: disposableDefinition.definition.lanes.map((lane) =>
              lane.key === "backlog"
                ? {
                    ...lane,
                    onEvent: [
                      {
                        name: "ci.passed",
                        when: { "==": [{ var: "event.payload.status" }, "green"] },
                        to: "done",
                      },
                    ],
                  }
                : lane,
            ),
          };
          const webhookDefinitionSave = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.saveBoardDefinition,
            {
              boardId: disposable.boardId,
              definition: webhookDefinition,
              expectedVersionHash: disposableDefinition.versionHash,
              source: "save",
            },
            rpcSession,
          )) as WorkflowSaveBoardDefinitionResult;
          assert.isTrue(webhookDefinitionSave.ok);

          const webhookTicket = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.createTicket,
            {
              boardId: disposable.boardId,
              title: "Webhook ticket",
              initialLane: "backlog",
            },
            rpcSession,
          )) as { readonly ticketId: string };

          const webhookConfig = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getWebhookConfig,
            { boardId: disposable.boardId, rotate: true },
            rpcSession,
          )) as {
            readonly path: string;
            readonly hasToken: boolean;
            readonly tokenPrefix?: string;
            readonly token?: string;
          };
          assert.equal(
            webhookConfig.path,
            `/hooks/plugins/workflow-boards/webhook/${encodeURIComponent(disposable.boardId)}`,
          );
          assert.equal(webhookConfig.hasToken, true);
          assert.isString(webhookConfig.token);
          assert.isString(webhookConfig.tokenPrefix);
          const webhookToken = webhookConfig.token;
          if (webhookToken === undefined) {
            return yield* Effect.die("webhook token was not returned on rotate");
          }

          const readWebhookConfig = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getWebhookConfig,
            { boardId: disposable.boardId },
            rpcSession,
          )) as {
            readonly path: string;
            readonly hasToken: boolean;
            readonly tokenPrefix?: string;
            readonly token?: string;
          };
          assert.equal(readWebhookConfig.hasToken, true);
          assert.equal(readWebhookConfig.path, webhookConfig.path);
          assert.equal(readWebhookConfig.token, undefined);
          assert.equal(readWebhookConfig.tokenPrefix, webhookConfig.tokenPrefix);

          const matchedWebhookRoute = yield* httpRegistry.match({
            pluginId,
            method: "POST",
            path: `/webhook/${encodeURIComponent(disposable.boardId)}`,
          });
          assert.isTrue(Option.isSome(matchedWebhookRoute));
          if (Option.isNone(matchedWebhookRoute)) {
            return yield* Effect.die("workflow webhook route was not registered");
          }
          assert.equal(matchedWebhookRoute.value.descriptor.auth, "public");
          assert.equal(matchedWebhookRoute.value.descriptor.maxBodyBytes, 64 * 1024);

          const encodeBody = (body: string) => new TextEncoder().encode(body);
          const noopLogger = {
            debug: () => Effect.void,
            info: () => Effect.void,
            warn: () => Effect.void,
            error: () => Effect.void,
          };
          const postWebhook = (token: string, body: string) =>
            matchedWebhookRoute.value.descriptor.handler(
              {
                method: "POST",
                params: matchedWebhookRoute.value.params,
                query: {},
                headers: { "x-t3-webhook-token": token },
                body: encodeBody(body),
              },
              { pluginId, logger: noopLogger },
            );

          const acceptedWebhook = yield* postWebhook(
            webhookToken,
            `{"name":"ci.passed","ticketId":"${webhookTicket.ticketId}","deliveryId":"delivery-ok","payload":{"status":"green","nested":{"constructor":"drop"}}}`,
          );
          assert.equal(acceptedWebhook.status, 202);
          assert.equal((acceptedWebhook.body as { readonly outcome?: string }).outcome, "moved");
          assert.equal((acceptedWebhook.body as { readonly toLane?: string }).toLane, "done");

          const webhookDetail = (yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.getTicketDetail,
            { ticketId: webhookTicket.ticketId },
            rpcSession,
          )) as WorkflowTicketDetailView;
          assert.equal(webhookDetail.ticket.currentLaneKey, "done");
          assert.isTrue(
            webhookDetail.routeHistory?.some(
              (entry) => entry.source === "external_event" && entry.eventName === "ci.passed",
            ) === true,
          );

          const wrongTokenWebhook = yield* postWebhook(
            "wrong-token",
            `{"name":"ci.passed","ticketId":"${webhookTicket.ticketId}","deliveryId":"delivery-wrong-token","payload":{"status":"green"}}`,
          );
          assert.equal(wrongTokenWebhook.status, 404);

          const malformedWebhook = yield* postWebhook(webhookToken, "{");
          assert.equal(malformedWebhook.status, 404);

          // No-oracle: an unknown board is indistinguishable from a wrong token —
          // same 404 status AND same body, so a webhook URL can't be used to
          // enumerate which boards exist.
          const unknownBoardWebhook = yield* matchedWebhookRoute.value.descriptor.handler(
            {
              method: "POST",
              params: { boardId: "workflow-boards-project__does-not-exist" },
              query: {},
              headers: { "x-t3-webhook-token": webhookToken },
              body: encodeBody(
                `{"name":"ci.passed","ticketId":"${webhookTicket.ticketId}","payload":{}}`,
              ),
            },
            { pluginId, logger: noopLogger },
          );
          assert.equal(unknownBoardWebhook.status, 404);
          assert.deepEqual(unknownBoardWebhook.body, wrongTokenWebhook.body);
          assert.deepEqual(malformedWebhook.body, wrongTokenWebhook.body);

          const webhookRowsBeforeDelete = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_board_webhook
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(webhookRowsBeforeDelete[0]?.count, 1);
          const deliveryRowsBeforeDelete = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_webhook_delivery
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(deliveryRowsBeforeDelete[0]?.count, 1);

          yield* dispatcher.call(
            pluginId,
            WORKFLOW_WS_METHODS.deleteBoard,
            { boardId: disposable.boardId },
            rpcSession,
          );
          // The cascade removed the board's projection + version rows.
          const remainingBoardRows = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_projection_board
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(remainingBoardRows[0]?.count, 0);
          const remainingVersionRows = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_board_version
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(remainingVersionRows[0]?.count, 0);
          const remainingWebhookRows = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_board_webhook
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(remainingWebhookRows[0]?.count, 0);
          const remainingDeliveryRows = yield* sql<{ readonly count: number }>`
            SELECT count(*) AS "count" FROM p_workflow_boards_webhook_delivery
            WHERE board_id = ${disposable.boardId}
          `;
          assert.equal(remainingDeliveryRows[0]?.count, 0);
          // getBoard on the deleted board now fails (definition unregistered).
          const getDeletedExit = yield* dispatcher
            .call(pluginId, WORKFLOW_WS_METHODS.getBoard, { boardId: disposable.boardId }, rpcSession)
            .pipe(Effect.exit);
          assert.isTrue(getDeletedExit._tag === "Failure");

          const tables = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name LIKE 'p_workflow_boards_%'
            ORDER BY name
          `;
          const tableNames = tables.map((row) => row.name);
          for (const owned of OWNED_TABLES) {
            assert.include(tableNames, owned);
          }
          assert.equal(tableNames.length, OWNED_TABLES.length);

          const indexes = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND name LIKE 'p_workflow_boards_%'
            ORDER BY name
          `;
          const indexNames = indexes.map((row) => row.name);
          for (const owned of OWNED_INDEXES) {
            assert.include(indexNames, owned);
          }
          assert.equal(indexNames.length, OWNED_INDEXES.length);

          const allTables = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master
            WHERE type = 'table'
          `;
          const legacyNames = new Set<string>(LEGACY_TABLE_NAMES);
          const legacy = allTables.filter((row) => legacyNames.has(row.name));
          assert.equal(legacy.length, 0);

          // --- Column-shape guard (schema faithfulness, not just object names).
          // Names + counts alone would false-pass a dropped/retyped column or a
          // removed DEFAULT/UNIQUE/partial-WHERE — the exact regression class that
          // only surfaces once the read model (A1b) or engine (A3) reads/writes
          // these tables. Assert exact per-table column counts + the highest-risk
          // constraints (the 4 folded dispatch_outbox columns, key DEFAULTs/UNIQUEs,
          // and the partial pr_state index). Counts are generated from the faithful
          // baseline; they change only on a deliberate schema edit.
          for (const [table, expectedColumns] of Object.entries(EXPECTED_TABLE_COLUMN_COUNTS)) {
            const columns = yield* sql.unsafe<{ readonly name: string }>(
              `SELECT name FROM pragma_table_info('${table}')`,
            );
            assert.equal(columns.length, expectedColumns, `column count for ${table}`);
          }

          const ddlRows = yield* sql<{ readonly name: string; readonly sql: string }>`
            SELECT name, sql FROM sqlite_master
            WHERE name LIKE 'p_workflow_boards_%' AND sql IS NOT NULL
          `;
          const ddlByName = new Map(ddlRows.map((row) => [row.name, row.sql]));
          const assertDdlIncludes = (name: string, needle: string) =>
            assert.include(ddlByName.get(name) ?? "", needle, `${name} DDL missing: ${needle}`);
          // The 4 dispatch_outbox ALTER columns must be folded inline.
          assertDdlIncludes("p_workflow_boards_dispatch_outbox", "options_json");
          assertDdlIncludes("p_workflow_boards_dispatch_outbox", "message_id");
          assertDdlIncludes("p_workflow_boards_dispatch_outbox", "project_id");
          assertDdlIncludes("p_workflow_boards_dispatch_outbox", "thread_title");
          assertDdlIncludes("p_workflow_boards_dispatch_outbox", "runtime_mode");
          // High-risk DEFAULT / UNIQUE / partial-index constraints.
          assertDdlIncludes("p_workflow_boards_pr_state", "DEFAULT 'open'");
          assertDdlIncludes("p_workflow_boards_events", "UNIQUE");
          assertDdlIncludes("p_workflow_boards_work_source_mapping", "DEFAULT 'active'");
          assertDdlIncludes(
            "p_workflow_boards_outbound_delivery",
            "UNIQUE (event_sequence, rule_id)",
          );
          assertDdlIncludes(
            "p_workflow_boards_idx_workflow_pr_state_open",
            "WHERE pr_state = 'open'",
          );

          // The migrator recorded the applied migration.
          const migrationRows = yield* sql<{
            readonly version: number;
            readonly name: string;
          }>`
            SELECT version, name FROM plugin_migrations
            WHERE plugin_id = ${pluginId}
            ORDER BY version
          `;
          assert.equal(migrationRows.length, 1);
          assert.equal(migrationRows[0]?.version, 1);
          assert.equal(migrationRows[0]?.name, "workflow_schema");
        }),
      ),
    ),
  );
});
