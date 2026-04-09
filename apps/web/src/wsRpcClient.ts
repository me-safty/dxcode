import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { getKnownEnvironmentWsBaseUrl, type KnownEnvironment } from "@t3tools/client-runtime";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import { Effect, Stream } from "effect";

import { getPrimaryKnownEnvironment } from "./environments/primary/bootstrap";
import { type WsRpcProtocolClient } from "./rpc/protocol";
import { resetWsReconnectBackoff } from "./rpc/wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
}

export interface WsRpcClientEntry {
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly environmentId: EnvironmentId;
}

const wsRpcClientEntriesByEnvironmentId = new Map<EnvironmentId, WsRpcClientEntry>();
const wsRpcClientRegistryListeners = new Set<() => void>();

function emitWsRpcClientRegistryChange() {
  for (const listener of wsRpcClientRegistryListeners) {
    listener();
  }
}

function createWsRpcClientEntry(knownEnvironment: KnownEnvironment): WsRpcClientEntry {
  const baseUrl = getKnownEnvironmentWsBaseUrl(knownEnvironment);
  if (!baseUrl) {
    throw new Error(`Unable to resolve websocket bootstrap URL for ${knownEnvironment.label}.`);
  }
  if (!knownEnvironment.environmentId) {
    throw new Error(
      `Known environment ${knownEnvironment.label} is missing its environmentId. Resolve the environment descriptor before creating a websocket client.`,
    );
  }

  return {
    knownEnvironment,
    client: createWsRpcClient(new WsTransport(baseUrl)),
    environmentId: knownEnvironment.environmentId,
  };
}

export function subscribeWsRpcClientRegistry(listener: () => void): () => void {
  wsRpcClientRegistryListeners.add(listener);
  return () => {
    wsRpcClientRegistryListeners.delete(listener);
  };
}

export function listWsRpcClientEntries(): ReadonlyArray<WsRpcClientEntry> {
  return [...wsRpcClientEntriesByEnvironmentId.values()];
}

export function ensureWsRpcClientEntryForKnownEnvironment(
  knownEnvironment: KnownEnvironment,
): WsRpcClientEntry {
  if (!knownEnvironment.environmentId) {
    throw new Error(
      `Known environment ${knownEnvironment.label} is missing its environmentId. Resolve the environment descriptor before registering it.`,
    );
  }

  const existingEntry = wsRpcClientEntriesByEnvironmentId.get(knownEnvironment.environmentId);
  if (existingEntry) {
    return existingEntry;
  }

  const entry = createWsRpcClientEntry(knownEnvironment);
  wsRpcClientEntriesByEnvironmentId.set(entry.environmentId, entry);
  emitWsRpcClientRegistryChange();
  return entry;
}

export function registerWsRpcClientEntry(input: {
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly environmentId: EnvironmentId;
}): WsRpcClientEntry {
  const existingEntry = wsRpcClientEntriesByEnvironmentId.get(input.environmentId);
  if (existingEntry) {
    if (existingEntry.client !== input.client) {
      throw new Error(
        `Environment ${input.environmentId} is already registered to an active websocket client.`,
      );
    }
    return existingEntry;
  }
  if (
    input.knownEnvironment.environmentId !== undefined &&
    input.knownEnvironment.environmentId !== input.environmentId
  ) {
    throw new Error(
      `Known environment ${input.knownEnvironment.label} does not match environment ${input.environmentId}.`,
    );
  }

  const entry: WsRpcClientEntry = {
    knownEnvironment: input.knownEnvironment,
    client: input.client,
    environmentId: input.environmentId,
  };
  wsRpcClientEntriesByEnvironmentId.set(entry.environmentId, entry);
  emitWsRpcClientRegistryChange();
  return entry;
}

export function getPrimaryWsRpcClientEntry(): WsRpcClientEntry {
  const primaryKnownEnvironment = getPrimaryKnownEnvironment();
  if (!primaryKnownEnvironment) {
    throw new Error("Unable to resolve the primary websocket environment.");
  }

  return ensureWsRpcClientEntryForKnownEnvironment(primaryKnownEnvironment);
}

export function getPrimaryWsRpcClient(): WsRpcClient {
  return getPrimaryWsRpcClientEntry().client;
}

export function readWsRpcClientEntryForEnvironment(
  environmentId: EnvironmentId,
): WsRpcClientEntry | null {
  const entry = wsRpcClientEntriesByEnvironmentId.get(environmentId);
  return entry ? entry : null;
}

export function getWsRpcClientForEnvironment(environmentId: EnvironmentId): WsRpcClient {
  const entry = readWsRpcClientEntryForEnvironment(environmentId);
  if (!entry) {
    throw new Error(`No websocket client registered for environment ${environmentId}.`);
  }
  return entry.client;
}

export async function removeWsRpcClientEntry(environmentId: EnvironmentId): Promise<boolean> {
  const entry = wsRpcClientEntriesByEnvironmentId.get(environmentId);
  if (!entry) {
    return false;
  }

  wsRpcClientEntriesByEnvironmentId.delete(environmentId);
  emitWsRpcClientRegistryChange();
  await entry.client.dispose();
  return true;
}

export async function __resetWsRpcClientForTests() {
  for (const entry of wsRpcClientEntriesByEnvironmentId.values()) {
    await entry.client.dispose();
  }
  wsRpcClientEntriesByEnvironmentId.clear();
  wsRpcClientRegistryListeners.clear();
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
  };
}
