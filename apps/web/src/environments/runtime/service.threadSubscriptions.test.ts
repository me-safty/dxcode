import { QueryClient } from "@tanstack/react-query";
import type { WsRpcClient } from "@t3tools/client-runtime";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockSubscribeThread = vi.fn();
const mockThreadUnsubscribe = vi.fn();
const mockCreateEnvironmentConnection = vi.fn();
const mockCreateWsRpcClient = vi.fn();
const mockWaitForSavedEnvironmentRegistryHydration = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();
const mockGetSavedEnvironmentRecord = vi.fn();
const mockReadSavedEnvironmentBearerToken = vi.fn();
const mockReadSavedEnvironmentCredential = vi.fn();
const mockSavedEnvironmentRegistrySubscribe = vi.fn();
const mockGetPrimaryKnownEnvironment = vi.hoisted(() => vi.fn());
const mockSavedEnvironmentRuntimeById: Record<string, Record<string, unknown>> = {};
const mockFetchRemoteSessionState = vi.fn();
const mockResolveRemoteWebSocketConnectionUrl = vi.fn(async () => "ws://remote.example.test/ws");
const mockRemoteHttpRunPromise = vi.fn((effect: Promise<unknown>) => effect);
const mockConnectionReconnects: Array<ReturnType<typeof vi.fn>> = [];
const mockGetClientSettings = vi.hoisted(() => vi.fn());
const mockTransportLifecycleHandlers: Array<{
  readonly onOpen?: () => void;
  readonly onClose?: (
    details: { readonly code: number; readonly reason: string },
    context: { readonly intentional: boolean },
  ) => void;
}> = [];
let savedEnvironmentRegistryListener: (() => void) | null = null;

function MockWsTransport(
  _url: unknown,
  lifecycleHandlers?: {
    readonly onOpen?: () => void;
    readonly onClose?: (
      details: { readonly code: number; readonly reason: string },
      context: { readonly intentional: boolean },
    ) => void;
  },
) {
  mockTransportLifecycleHandlers.push(lifecycleHandlers ?? {});
}

vi.mock("../primary", () => ({
  getPrimaryKnownEnvironment: mockGetPrimaryKnownEnvironment,
}));

vi.mock("../../lib/runtime", () => ({
  webRuntime: {
    runPromise: mockRemoteHttpRunPromise,
  },
}));

vi.mock("~/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  getClientSettings: mockGetClientSettings,
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: mockGetSavedEnvironmentRecord,
  hasSavedEnvironmentRegistryHydrated: vi.fn(() => true),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: vi.fn(),
  readSavedEnvironmentBearerToken: mockReadSavedEnvironmentBearerToken,
  readSavedEnvironmentCredential: mockReadSavedEnvironmentCredential,
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    subscribe: mockSavedEnvironmentRegistrySubscribe,
    getState: () => ({
      upsert: vi.fn(),
      remove: vi.fn(),
      markConnected: vi.fn(),
      rename: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      byId: mockSavedEnvironmentRuntimeById,
      ensure: (environmentId: EnvironmentId) => {
        mockSavedEnvironmentRuntimeById[environmentId] ??= {};
      },
      patch: (environmentId: EnvironmentId, patch: Record<string, unknown>) => {
        mockSavedEnvironmentRuntimeById[environmentId] = {
          ...mockSavedEnvironmentRuntimeById[environmentId],
          ...patch,
        };
      },
      clear: (environmentId: EnvironmentId) => {
        delete mockSavedEnvironmentRuntimeById[environmentId];
      },
    }),
  },
  waitForSavedEnvironmentRegistryHydration: mockWaitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken: vi.fn(),
  writeSavedEnvironmentCredential: vi.fn(),
}));

vi.mock("./connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connection")>()),
  createEnvironmentConnection: mockCreateEnvironmentConnection,
}));

vi.mock("@t3tools/client-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@t3tools/client-runtime")>();
  const stubWsClient: WsRpcClient = {
    dispose: async () => undefined,
    reconnect: async () => undefined,
    isHeartbeatFresh: () => false,
    cloud: {
      getRelayClientStatus: vi.fn(),
      installRelayClient: vi.fn(),
    },
    orchestration: {
      dispatchCommand: vi.fn(),
      getTurnDiff: vi.fn(),
      getFullThreadDiff: vi.fn(),
      getArchivedShellSnapshot: vi.fn(),
      subscribeShell: vi.fn(() => () => undefined),
      subscribeThread: mockSubscribeThread,
    },
    terminal: {
      open: vi.fn(),
      attach: vi.fn(() => () => undefined),
      write: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
      onMetadata: vi.fn(() => () => undefined),
    },
    projects: {
      searchEntries: vi.fn(),
      writeFile: vi.fn(),
    },
    filesystem: {
      browse: vi.fn(),
    },
    sourceControl: {
      lookupRepository: vi.fn(),
      cloneRepository: vi.fn(),
      publishRepository: vi.fn(),
    },
    shell: {
      openInEditor: vi.fn(),
    },
    vcs: {
      pull: vi.fn(),
      refreshStatus: vi.fn(),
      onStatus: vi.fn(() => () => undefined),
      listRefs: vi.fn(),
      createWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      createRef: vi.fn(),
      switchRef: vi.fn(),
      init: vi.fn(),
    },
    git: {
      runStackedAction: vi.fn(),
      resolvePullRequest: vi.fn(),
      preparePullRequestThread: vi.fn(),
    },
    review: {
      getDiffPreview: vi.fn(),
    },
    server: {
      getConfig: vi.fn(),
      refreshProviders: vi.fn(),
      discoverSourceControl: vi.fn(),
      updateProvider: vi.fn(),
      upsertKeybinding: vi.fn(),
      removeKeybinding: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      subscribeConfig: vi.fn(() => () => undefined),
      subscribeLifecycle: vi.fn(() => () => undefined),
      subscribeAuthAccess: vi.fn(() => () => undefined),
      getTraceDiagnostics: vi.fn(),
      getProcessDiagnostics: vi.fn(),
      getProcessResourceHistory: vi.fn(),
      signalProcess: vi.fn(),
    },
  };
  return {
    ...actual,
    createWsRpcClient: vi.fn(() => stubWsClient),
    fetchRemoteSessionState: mockFetchRemoteSessionState,
    resolveRemoteWebSocketConnectionUrl: mockResolveRemoteWebSocketConnectionUrl,
  };
});

vi.mock("../../rpc/wsTransport", () => ({
  WsTransport: MockWsTransport,
}));

function makeThreadShellSnapshot(params: {
  readonly threadId: ThreadId;
  readonly sessionStatus?:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly hasActionableProposedPlan?: boolean;
}): OrchestrationShellSnapshot {
  const projectId = ProjectId.make("project-1");
  const turnId = TurnId.make("turn-1");

  return {
    snapshotSequence: 1,
    projects: [],
    updatedAt: "2026-04-13T00:00:00.000Z",
    threads: [
      {
        id: params.threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn:
          params.sessionStatus === "running"
            ? {
                turnId,
                state: "running",
                requestedAt: "2026-04-13T00:00:00.000Z",
                startedAt: "2026-04-13T00:00:01.000Z",
                completedAt: null,
                assistantMessageId: null,
              }
            : null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        archivedAt: null,
        session: params.sessionStatus
          ? {
              threadId: params.threadId,
              status: params.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: params.sessionStatus === "running" ? turnId : null,
              lastError: null,
              updatedAt: "2026-04-13T00:00:00.000Z",
            }
          : null,
        latestUserMessageAt: null,
        hasPendingApprovals: params.hasPendingApprovals ?? false,
        hasPendingUserInput: params.hasPendingUserInput ?? false,
        hasActionableProposedPlan: params.hasActionableProposedPlan ?? false,
      },
    ],
  };
}

describe("retainThreadDetailSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "env-1",
      label: "Primary environment",
      source: "window-origin",
      target: {
        httpBaseUrl: "http://127.0.0.1:3000/",
        wsBaseUrl: "ws://127.0.0.1:3000/",
      },
      environmentId: EnvironmentId.make("env-1"),
    });

    mockThreadUnsubscribe.mockImplementation(() => undefined);
    mockSubscribeThread.mockImplementation(() => mockThreadUnsubscribe);
    mockCreateWsRpcClient.mockReturnValue({
      server: {
        getConfig: vi.fn(async () => ({
          environment: {
            environmentId: EnvironmentId.make("env-remote"),
            label: "Remote env",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        })),
      },
      isHeartbeatFresh: vi.fn(() => true),
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });
    mockCreateEnvironmentConnection.mockImplementation((input) => {
      const reconnect = vi.fn(async () => undefined);
      mockConnectionReconnects.push(reconnect);
      queueMicrotask(() => {
        input.onConfigSnapshot?.({
          environment: {
            environmentId: input.knownEnvironment.environmentId,
            label: input.knownEnvironment.label,
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        });
      });
      return {
        kind: input.kind,
        environmentId: input.knownEnvironment.environmentId,
        knownEnvironment: input.knownEnvironment,
        client: input.client,
        ensureBootstrapped: vi.fn(async () => undefined),
        reconnect,
        dispose: vi.fn(async () => undefined),
      };
    });
    savedEnvironmentRegistryListener = null;
    mockSavedEnvironmentRegistrySubscribe.mockImplementation((listener: () => void) => {
      savedEnvironmentRegistryListener = listener;
      return () => {
        if (savedEnvironmentRegistryListener === listener) {
          savedEnvironmentRegistryListener = null;
        }
      };
    });
    mockWaitForSavedEnvironmentRegistryHydration.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
    mockGetSavedEnvironmentRecord.mockReturnValue(null);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue(null);
    mockReadSavedEnvironmentCredential.mockImplementation(async () => {
      const token = await mockReadSavedEnvironmentBearerToken();
      return token ? { version: 1, method: "bearer", token } : null;
    });
    mockGetClientSettings.mockReturnValue(DEFAULT_CLIENT_SETTINGS);
    for (const key of Object.keys(mockSavedEnvironmentRuntimeById)) {
      delete mockSavedEnvironmentRuntimeById[key];
    }
    mockFetchRemoteSessionState.mockResolvedValue({
      authenticated: true,
      scopes: ["orchestration:read"],
    });
    mockConnectionReconnects.length = 0;
    mockTransportLifecycleHandlers.length = 0;
  });

  afterEach(async () => {
    const { resetEnvironmentServiceForTests } = await import("./service");
    await resetEnvironmentServiceForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps thread detail subscriptions warm across releases until idle eviction", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");

    const releaseFirst = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    const releaseSecond = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(28 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("refreshes a retained thread detail subscription on demand", async () => {
    const {
      refreshRetainedThreadDetailSubscription,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-refresh");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    expect(refreshRetainedThreadDetailSubscription(environmentId, threadId)).toBe(true);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(2);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("does not refresh an unretained thread detail subscription", async () => {
    const { refreshRetainedThreadDetailSubscription, resetEnvironmentServiceForTests } =
      await import("./service");

    expect(
      refreshRetainedThreadDetailSubscription(
        EnvironmentId.make("env-1"),
        ThreadId.make("thread-missing"),
      ),
    ).toBe(false);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();
    expect(mockSubscribeThread).not.toHaveBeenCalled();

    await resetEnvironmentServiceForTests();
  });

  it("does not start the primary connection until the known environment has an id", async () => {
    mockGetPrimaryKnownEnvironment.mockReturnValue({
      id: "env-1",
      label: "Primary environment",
      source: "window-origin",
      target: {
        httpBaseUrl: "http://127.0.0.1:3000/",
        wsBaseUrl: "ws://127.0.0.1:3000/",
      },
    });
    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());

    expect(mockCreateEnvironmentConnection).not.toHaveBeenCalled();
    expect(listEnvironmentConnections()).toEqual([]);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps non-idle thread detail subscriptions attached until the thread becomes idle", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-active");

    const connectionInput = mockCreateEnvironmentConnection.mock.calls[0]?.[0];
    expect(connectionInput).toBeDefined();

    connectionInput.syncShellSnapshot(
      makeThreadShellSnapshot({
        threadId,
        sessionStatus: "ready",
        hasPendingApprovals: true,
      }),
      environmentId,
    );

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    connectionInput.applyShellEvent(
      {
        kind: "thread-upserted",
        sequence: 2,
        thread: makeThreadShellSnapshot({
          threadId,
          sessionStatus: "idle",
        }).threads[0]!,
      },
      environmentId,
    );

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("reattaches retained thread detail subscriptions after a saved environment reconnect replaces the client", async () => {
    const environmentId = EnvironmentId.make("env-remote");
    const threadId = ThreadId.make("thread-reconnect");
    const record = {
      environmentId,
      label: "Remote env",
      httpBaseUrl: "http://remote.example.test",
      wsBaseUrl: "ws://remote.example.test",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
    };
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("bearer-token");

    const {
      disconnectSavedEnvironment,
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });
    const createConnectionCallsBeforeReconnect = mockCreateEnvironmentConnection.mock.calls.length;

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    await disconnectSavedEnvironment(environmentId);
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(
      listEnvironmentConnections().some((connection) => connection.environmentId === environmentId),
    ).toBe(false);

    const reconnectPromise = reconnectSavedEnvironment(environmentId);
    await vi.advanceTimersByTimeAsync(200);
    await reconnectPromise;
    await vi.waitFor(() => {
      expect(mockCreateEnvironmentConnection).toHaveBeenCalledTimes(
        createConnectionCallsBeforeReconnect + 1,
      );
      expect(mockSubscribeThread).toHaveBeenCalledTimes(2);
    });

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("refreshes retained thread detail subscriptions after a saved environment reconnect", async () => {
    const environmentId = EnvironmentId.make("env-remote");
    const threadId = ThreadId.make("thread-reconnect-refresh");
    const record = {
      environmentId,
      label: "Remote env",
      httpBaseUrl: "http://remote.example.test",
      wsBaseUrl: "ws://remote.example.test",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
    };
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("bearer-token");

    const {
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const release = retainThreadDetailSubscription(environmentId, threadId);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(1);

    await reconnectSavedEnvironment(environmentId);

    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThread).toHaveBeenCalledTimes(2);

    release();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("marks saved environment runtime connected after a successful reconnect", async () => {
    const environmentId = EnvironmentId.make("env-remote");
    const record = {
      environmentId,
      label: "Remote env",
      httpBaseUrl: "http://remote.example.test",
      wsBaseUrl: "ws://remote.example.test",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
    };
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("bearer-token");

    const {
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    mockSavedEnvironmentRuntimeById[environmentId] = {
      ...mockSavedEnvironmentRuntimeById[environmentId],
      connectionState: "disconnected",
      disconnectedAt: "2026-05-01T00:00:00.000Z",
    };

    await reconnectSavedEnvironment(environmentId);

    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connected");
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.disconnectedAt).toBeNull();
    stop();
    await resetEnvironmentServiceForTests();
  });

  it("keeps healthy environment streams connected when the browser resumes from the background", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    vi.stubGlobal("document", {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visibilityState;
      },
    });
    vi.stubGlobal("window", {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    });

    const { resetEnvironmentServiceForTests, startEnvironmentConnectionService } =
      await import("./service");
    mockCreateEnvironmentConnection.mockImplementation((input) => {
      const reconnect = vi.fn(async () => undefined);
      mockConnectionReconnects.push(reconnect);
      queueMicrotask(() => {
        input.onConfigSnapshot?.({
          environment: {
            environmentId: input.knownEnvironment.environmentId,
            label: input.knownEnvironment.label,
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        });
      });
      return {
        kind: input.kind,
        environmentId: input.knownEnvironment.environmentId,
        knownEnvironment: input.knownEnvironment,
        client: {
          ...input.client,
          isHeartbeatFresh: vi.fn(() => true),
        },
        ensureBootstrapped: vi.fn(async () => undefined),
        reconnect,
        dispose: vi.fn(async () => undefined),
      };
    });

    const stop = startEnvironmentConnectionService(new QueryClient());
    expect(mockConnectionReconnects).toHaveLength(1);

    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("reconnects stale environment streams when the browser resumes from the background", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    vi.stubGlobal("document", {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visibilityState;
      },
    });
    vi.stubGlobal("window", {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    });
    mockCreateWsRpcClient.mockReturnValue({
      server: {
        getConfig: vi.fn(async () => ({
          environment: {
            environmentId: EnvironmentId.make("env-remote"),
            label: "Remote env",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
        })),
      },
      isHeartbeatFresh: vi.fn(() => false),
      orchestration: {
        subscribeThread: mockSubscribeThread,
      },
    });

    const { resetEnvironmentServiceForTests, startEnvironmentConnectionService } =
      await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    expect(mockConnectionReconnects).toHaveLength(1);

    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(mockConnectionReconnects[0]).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("auto reconnects saved SSH environments after an unexpected close when enabled", async () => {
    const environmentId = EnvironmentId.make("env-ssh");
    const target = {
      alias: "devbox",
      hostname: "devbox.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env",
      httpBaseUrl: "http://127.0.0.1:43001",
      wsBaseUrl: "ws://127.0.0.1:43001",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockGetClientSettings.mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      autoReconnectSshConnections: true,
    });
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const savedConnectionCalls = mockCreateEnvironmentConnection.mock.calls.filter(
      ([input]) => input.kind === "saved",
    );
    expect(savedConnectionCalls).toHaveLength(1);
    const savedReconnect = mockConnectionReconnects.at(-1);
    expect(savedReconnect).toBeDefined();

    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onClose);
    expect(savedLifecycle?.onClose).toBeDefined();
    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connecting");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(savedReconnect).toHaveBeenCalledTimes(1);
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connected");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("cancels a pending SSH auto reconnect timer when the user reconnects manually", async () => {
    const environmentId = EnvironmentId.make("env-ssh-manual-reconnect");
    const target = {
      alias: "devbox-manual",
      hostname: "devbox-manual.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env manual reconnect",
      httpBaseUrl: "http://127.0.0.1:43004",
      wsBaseUrl: "ws://127.0.0.1:43004",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockGetClientSettings.mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      autoReconnectSshConnections: true,
    });
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const savedReconnect = mockConnectionReconnects.at(-1);
    expect(savedReconnect).toBeDefined();

    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onClose);
    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    await reconnectSavedEnvironment(environmentId);
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("dedupes manual reconnect while SSH auto reconnect is already in progress", async () => {
    const environmentId = EnvironmentId.make("env-ssh-overlap-reconnect");
    const target = {
      alias: "devbox-overlap",
      hostname: "devbox-overlap.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env overlap reconnect",
      httpBaseUrl: "http://127.0.0.1:43006",
      wsBaseUrl: "ws://127.0.0.1:43006",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockGetClientSettings.mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      autoReconnectSshConnections: true,
    });
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      reconnectSavedEnvironment,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    let finishReconnect = () => {};
    const reconnectGate = new Promise<void>((resolve) => {
      finishReconnect = resolve;
    });
    const savedReconnect = mockConnectionReconnects.at(-1);
    expect(savedReconnect).toBeDefined();
    savedReconnect?.mockImplementation(async () => {
      await reconnectGate;
    });

    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onClose);
    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    const manualReconnect = reconnectSavedEnvironment(environmentId);
    await Promise.resolve();
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    finishReconnect();
    await manualReconnect;
    expect(savedReconnect).toHaveBeenCalledTimes(1);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("does not auto reconnect saved SSH environments when disabled", async () => {
    const environmentId = EnvironmentId.make("env-ssh-disabled");
    const target = {
      alias: "devbox-disabled",
      hostname: "devbox-disabled.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env disabled",
      httpBaseUrl: "http://127.0.0.1:43002",
      wsBaseUrl: "ws://127.0.0.1:43002",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const savedReconnect = mockConnectionReconnects.at(-1);
    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onClose);
    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(savedReconnect).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("continues auto reconnecting saved SSH environments every five seconds while failures continue", async () => {
    const environmentId = EnvironmentId.make("env-ssh-loop");
    const target = {
      alias: "devbox-loop",
      hostname: "devbox-loop.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env loop",
      httpBaseUrl: "http://127.0.0.1:43003",
      wsBaseUrl: "ws://127.0.0.1:43003",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockGetClientSettings.mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      autoReconnectSshConnections: true,
    });
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const savedReconnect = mockConnectionReconnects.at(-1);
    expect(savedReconnect).toBeDefined();
    savedReconnect?.mockRejectedValue(new Error("still down"));

    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onClose);
    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connecting");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(1);
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connecting");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(2);
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connecting");

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("continues auto reconnecting saved SSH environments when the socket opens before reconnect fails", async () => {
    const environmentId = EnvironmentId.make("env-ssh-open-then-fail");
    const target = {
      alias: "devbox-open-fail",
      hostname: "devbox-open-fail.example.test",
      username: null,
      port: null,
      source: "manual" as const,
    };
    const record = {
      environmentId,
      label: "SSH env open then fail",
      httpBaseUrl: "http://127.0.0.1:43005",
      wsBaseUrl: "ws://127.0.0.1:43005",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastConnectedAt: "2026-05-01T00:00:00.000Z",
      desktopSsh: target,
    };
    mockGetClientSettings.mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      autoReconnectSshConnections: true,
    });
    mockListSavedEnvironmentRecords.mockReturnValue([record]);
    mockGetSavedEnvironmentRecord.mockReturnValue(record);
    mockReadSavedEnvironmentBearerToken.mockResolvedValue("ssh-bearer-token");
    vi.stubGlobal("window", {
      desktopBridge: {
        ensureSshEnvironment: vi.fn(async () => ({
          target,
          httpBaseUrl: record.httpBaseUrl,
          wsBaseUrl: record.wsBaseUrl,
          pairingToken: null,
        })),
        fetchSshSessionState: vi.fn(async () => ({
          authenticated: true,
          scopes: ["orchestration:read"],
        })),
        issueSshWebSocketTicket: vi.fn(async () => ({ ticket: "ssh-ws-ticket" })),
      },
    });

    const {
      listEnvironmentConnections,
      resetEnvironmentServiceForTests,
      startEnvironmentConnectionService,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    savedEnvironmentRegistryListener?.();
    await vi.waitFor(() => {
      expect(
        listEnvironmentConnections().some(
          (connection) => connection.environmentId === environmentId,
        ),
      ).toBe(true);
    });

    const savedReconnect = mockConnectionReconnects.at(-1);
    expect(savedReconnect).toBeDefined();
    const savedLifecycle = mockTransportLifecycleHandlers.find((handlers) => handlers.onOpen);
    savedReconnect?.mockImplementation(async () => {
      savedLifecycle?.onOpen?.();
      throw new Error("metadata refresh failed");
    });

    savedLifecycle?.onClose?.({ code: 1006, reason: "transport lost" }, { intentional: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(1);
    expect(mockSavedEnvironmentRuntimeById[environmentId]?.connectionState).toBe("connecting");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(savedReconnect).toHaveBeenCalledTimes(2);

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("allows a larger idle cache before capacity eviction starts", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");

    for (let index = 0; index < 12; index += 1) {
      const release = retainThreadDetailSubscription(
        environmentId,
        ThreadId.make(`thread-${index + 1}`),
      );
      release();
    }

    expect(mockThreadUnsubscribe).not.toHaveBeenCalled();

    stop();
    await resetEnvironmentServiceForTests();
  });

  it("disposes cached thread detail subscriptions when the environment service resets", async () => {
    const {
      retainThreadDetailSubscription,
      startEnvironmentConnectionService,
      resetEnvironmentServiceForTests,
    } = await import("./service");

    const stop = startEnvironmentConnectionService(new QueryClient());
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-2");

    const release = retainThreadDetailSubscription(environmentId, threadId);
    release();

    await resetEnvironmentServiceForTests();
    expect(mockThreadUnsubscribe).toHaveBeenCalledTimes(1);

    stop();
  });
});
