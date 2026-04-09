import type {
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusStreamEvent,
} from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import {
  __resetWsRpcClientForTests,
  createWsRpcClient,
  ensureWsRpcClientEntryForKnownEnvironment,
  getPrimaryWsRpcClientEntry,
  registerWsRpcClientEntry,
  readWsRpcClientEntryForEnvironment,
} from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";
import type { WsRpcClient } from "./wsRpcClient";
import {
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from "./environments/primary/bootstrap";

const baseLocalStatus: GitStatusLocalResult = {
  isRepo: true,
  hasOriginRemote: true,
  isDefaultBranch: false,
  branch: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: GitStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

function createStubWsRpcClient(): WsRpcClient {
  return {
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    terminal: {
      open: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: vi.fn(() => () => undefined),
    },
    projects: {
      searchEntries: vi.fn(async () => []),
      writeFile: vi.fn(async () => undefined),
    },
    shell: {
      openInEditor: vi.fn(async () => undefined),
    },
    git: {
      pull: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
      runStackedAction: vi.fn(async () => ({}) as any),
      listBranches: vi.fn(async () => []),
      createWorktree: vi.fn(async () => undefined),
      removeWorktree: vi.fn(async () => undefined),
      createBranch: vi.fn(async () => undefined),
      checkout: vi.fn(async () => undefined),
      init: vi.fn(async () => undefined),
      resolvePullRequest: vi.fn(async () => undefined),
      preparePullRequestThread: vi.fn(async () => undefined),
    },
    server: {
      getConfig: vi.fn(async () => undefined),
      refreshProviders: vi.fn(async () => undefined),
      upsertKeybinding: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
      subscribeConfig: vi.fn(() => () => undefined),
      subscribeLifecycle: vi.fn(() => () => undefined),
      subscribeAuthAccess: vi.fn(() => () => undefined),
    },
    orchestration: {
      getSnapshot: vi.fn(async () => ({}) as any),
      dispatchCommand: vi.fn(async () => undefined),
      getTurnDiff: vi.fn(async () => undefined),
      getFullThreadDiff: vi.fn(async () => undefined),
      replayEvents: vi.fn(async () => []),
      onDomainEvent: vi.fn(() => () => undefined),
    },
  } as unknown as WsRpcClient;
}

describe("wsRpcClient", () => {
  afterEach(async () => {
    await __resetWsRpcClientForTests();
    resetPrimaryEnvironmentDescriptorForTests();
    vi.unstubAllGlobals();
  });

  it("reduces git status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies GitStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.git.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });

  it("does not fall back to the only registered client for an unbound environment", () => {
    ensureWsRpcClientEntryForKnownEnvironment({
      id: "known-env-a",
      environmentId: EnvironmentId.makeUnsafe("environment-a"),
      label: "Environment A",
      source: "manual",
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    });

    expect(
      readWsRpcClientEntryForEnvironment(EnvironmentId.makeUnsafe("environment-b")),
    ).toBeNull();
  });

  it("keys the primary websocket client by the resolved primary environment id", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:3773",
      },
      desktopBridge: undefined,
    });
    writePrimaryEnvironmentDescriptor({
      environmentId: EnvironmentId.makeUnsafe("environment-local"),
      label: "Local environment",
      platform: {
        os: "darwin",
        arch: "arm64",
      },
      serverVersion: "0.0.0-test",
      capabilities: {
        repositoryIdentity: true,
      },
    });

    const entry = getPrimaryWsRpcClientEntry();

    expect(entry.environmentId).toBe("environment-local");
    expect(entry.knownEnvironment.id).toBe("environment-local");
  });

  it("rejects registering a second client for an already-bound environment", () => {
    const environmentId = EnvironmentId.makeUnsafe("environment-a");
    ensureWsRpcClientEntryForKnownEnvironment({
      id: "known-env-a",
      environmentId,
      label: "Environment A",
      source: "manual",
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    });

    expect(() =>
      registerWsRpcClientEntry({
        knownEnvironment: {
          id: "duplicate-entry",
          environmentId,
          label: "Duplicate environment",
          source: "manual",
          target: {
            httpBaseUrl: "http://localhost:4000",
            wsBaseUrl: "ws://localhost:4000",
          },
        },
        client: createStubWsRpcClient(),
        environmentId,
      }),
    ).toThrow(`Environment ${environmentId} is already registered to an active websocket client.`);

    expect(readWsRpcClientEntryForEnvironment(environmentId)?.environmentId).toBe(environmentId);
  });

  it("rejects creating a known-environment client before the environment id is known", () => {
    expect(() =>
      ensureWsRpcClientEntryForKnownEnvironment({
        id: "known-env-a",
        label: "Environment A",
        source: "manual",
        target: {
          httpBaseUrl: "http://localhost:3000",
          wsBaseUrl: "ws://localhost:3000",
        },
      }),
    ).toThrow(
      "Known environment Environment A is missing its environmentId. Resolve the environment descriptor before registering it.",
    );
  });
});
