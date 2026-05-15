import type {
  ClientOrchestrationCommand,
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
  ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { MockIntegrationProvider } from "@t3tools/integrations-core/mock";
import type { BackendApi, BackendState } from "./t3work-types";

const MOCK_PROVIDERS: ServerProvider[] = [
  {
    instanceId: "codex" as any,
    driver: "codex" as any,
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "latest",
    status: "ready" as any,
    auth: {
      status: "authenticated" as any,
      type: "openai",
      label: "OpenAI",
      email: "dev@example.com",
    },
    checkedAt: new Date().toISOString(),
    models: [
      { slug: "gpt-4o", name: "GPT-4o", isCustom: false, capabilities: null },
      { slug: "o3-mini", name: "o3-mini", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: "opencode" as any,
    driver: "opencode" as any,
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    version: "1.3.15",
    status: "ready" as any,
    auth: {
      status: "authenticated" as any,
      type: "api_key",
      label: "OpenCode",
      email: "dev@example.com",
    },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "opencode-default",
        name: "OpenCode Default",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: "claude-code" as any,
    driver: "claude-code" as any,
    displayName: "Claude Code",
    enabled: false,
    installed: true,
    version: "0.2.111",
    status: "disabled" as any,
    auth: { status: "unauthenticated" as any },
    checkedAt: new Date().toISOString(),
    models: [],
    slashCommands: [],
    skills: [],
  },
];

const INITIAL_STATE: BackendState = {
  connectionStatus: "connected",
  serverConfig: {
    settings: DEFAULT_SERVER_SETTINGS,
    providers: MOCK_PROVIDERS,
    keybindings: [],
    keybindingsConfigPath: null,
    issues: [],
    availableEditors: ["vscode" as any, "cursor" as any, "zed" as any],
    observability: {
      logsDirectoryPath: "/tmp/t3/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
  } as any,
  providers: MOCK_PROVIDERS,
  error: null,
};

const mockIntegrationProvider = new MockIntegrationProvider();

function now() {
  return new Date().toISOString();
}

function randomId() {
  return `mock-${Math.random().toString(36).slice(2)}`;
}

export function createMockBackend(): BackendApi {
  let state = INITIAL_STATE;
  const configListeners = new Set<(event: ServerConfigStreamEvent) => void>();
  const lifecycleListeners = new Set<(event: ServerLifecycleStreamEvent) => void>();
  const shellListeners = new Set<(event: unknown) => void>();
  const threadListeners = new Map<string, Set<(event: unknown) => void>>();

  function notifyState(nextState: BackendState) {
    state = nextState;
  }

  function emitLifecycleEvent(event: ServerLifecycleStreamEvent) {
    for (const listener of lifecycleListeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  function emitThreadEvent(threadId: string, event: Record<string, unknown>) {
    const set = threadListeners.get(threadId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  async function simulateConversation(threadId: string, userText: string) {
    const turnId = randomId();
    const messageId = randomId();
    const assistantMessageId = randomId();

    // Emit user message
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.message-sent",
        threadId,
        messageId,
        role: "user",
        text: userText,
        turnId,
        streaming: false,
        createdAt: now(),
        updatedAt: now(),
      },
    });

    // Emit turn start
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.turn-start-requested",
        threadId,
        turnId,
        messageId,
        modelSelection: { instanceId: "codex", model: "gpt-4o" },
        runtimeMode: "full-access",
        interactionMode: "default",
        requestedAt: now(),
        createdAt: now(),
      },
    });

    // Emit session set (running)
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.session-set",
        threadId,
        session: {
          providerName: "codex",
          providerInstanceId: "codex",
          status: "running",
          activeTurnId: turnId,
          updatedAt: now(),
        },
      },
    });

    // Streaming response
    const words =
      "I'll help you with that. Let me analyze the codebase and provide a detailed response.";
    for (const word of words.split(" ")) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      emitThreadEvent(threadId, {
        type: "thread.event" as any,
        occurredAt: now(),
        payload: {
          type: "thread.message-sent",
          threadId,
          messageId: assistantMessageId,
          role: "assistant",
          text: word + " ",
          turnId,
          streaming: true,
          createdAt: now(),
          updatedAt: now(),
        },
      });
    }

    // Final assistant message
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.message-sent",
        threadId,
        messageId: assistantMessageId,
        role: "assistant",
        text: "",
        turnId,
        streaming: false,
        createdAt: now(),
        updatedAt: now(),
      },
    });

    // Activity
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.activity-appended",
        threadId,
        activity: {
          id: randomId(),
          tone: "info" as any,
          kind: "file_search",
          summary: "Analyzed repository structure: 42 files found",
          payload: {},
          turnId,
          createdAt: now(),
        },
      },
    });

    // Diff
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.turn-diff-completed",
        threadId,
        turnId,
        completedAt: now(),
        status: "ready" as any,
        files: [
          { path: "src/components/Button.tsx", additions: 12, deletions: 3 },
          { path: "src/styles.css", additions: 5, deletions: 0 },
        ],
        assistantMessageId,
        checkpointTurnCount: 1,
        createdAt: now(),
      },
    });

    // Session set (ready)
    emitThreadEvent(threadId, {
      type: "thread.event" as any,
      occurredAt: now(),
      payload: {
        type: "thread.session-set",
        threadId,
        session: {
          providerName: "codex",
          providerInstanceId: "codex",
          status: "ready",
          updatedAt: now(),
        },
      },
    });
  }

  // Simulate welcome after short delay
  setTimeout(() => {
    emitLifecycleEvent({
      type: "welcome",
      payload: {
        version: "0.0.24",
        appName: "T3 Work",
        environmentId: "mock-env",
        authDescriptor: { requiresAuth: false, method: "none" },
      },
    } as any);
  }, 100);

  return {
    get state() {
      return state;
    },

    async connect() {
      notifyState({ ...state, connectionStatus: "connected", error: null });
    },

    async disconnect() {
      notifyState({ ...state, connectionStatus: "disconnected", error: null });
    },

    async dispatchCommand(command: ClientOrchestrationCommand) {
      if (command.type === "thread.turn.start") {
        void simulateConversation(command.threadId as string, (command as any).message.text);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    },

    atlassian: {
      listAccounts: async () => mockIntegrationProvider.listAccounts(),
      connectBasic: async () => mockIntegrationProvider.listAccounts(),
      connectOAuth: async () => mockIntegrationProvider.listAccounts(),
      listProjects: async (account) => mockIntegrationProvider.listProjects(account),
      listResources: async (input) => mockIntegrationProvider.listResources(input),
      getResource: async (ref) => mockIntegrationProvider.getResource(ref.ref),
    },

    subscribeConfig(listener: (event: ServerConfigStreamEvent) => void) {
      configListeners.add(listener);
      return () => configListeners.delete(listener);
    },

    subscribeLifecycle(listener: (event: ServerLifecycleStreamEvent) => void) {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },

    subscribeShell(listener: (event: unknown) => void) {
      shellListeners.add(listener);
      return () => shellListeners.delete(listener);
    },

    subscribeThread(threadId: string, listener: (event: unknown) => void) {
      let set = threadListeners.get(threadId);
      if (!set) {
        set = new Set();
        threadListeners.set(threadId, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
  };
}
