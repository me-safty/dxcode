import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createOrchestrationRegistrySyncController,
  createSnapshotBootstrapController,
} from "./manager";
import type { WsRpcClient, WsRpcClientEntry } from "../../wsRpcClient";

function createTestClient(options?: {
  readonly getSnapshot?: () => Promise<{ readonly snapshotSequence: number }>;
}) {
  const lifecycleListeners = new Set<(event: any) => void>();
  const configListeners = new Set<(event: any) => void>();
  const terminalListeners = new Set<(event: any) => void>();

  const getSnapshot = vi.fn(
    options?.getSnapshot ??
      (async () =>
        ({
          snapshotSequence: 1,
          projects: [],
          threads: [],
        }) as any),
  );

  const client = {
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    server: {
      getConfig: vi.fn(async () => ({
        environment: {
          environmentId: EnvironmentId.makeUnsafe("env-1"),
        },
      })),
      subscribeConfig: (listener: (event: any) => void) => {
        configListeners.add(listener);
        return () => configListeners.delete(listener);
      },
      subscribeLifecycle: (listener: (event: any) => void) => {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      },
      subscribeAuthAccess: () => () => undefined,
      refreshProviders: vi.fn(async () => undefined),
      upsertKeybinding: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
    },
    orchestration: {
      getSnapshot,
      dispatchCommand: vi.fn(async () => undefined),
      getTurnDiff: vi.fn(async () => undefined),
      getFullThreadDiff: vi.fn(async () => undefined),
      replayEvents: vi.fn(async () => []),
      onDomainEvent: () => () => undefined,
    },
    terminal: {
      open: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: (listener: (event: any) => void) => {
        terminalListeners.add(listener);
        return () => terminalListeners.delete(listener);
      },
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
  } as unknown as WsRpcClient;

  return {
    client,
    getSnapshot,
    emitWelcome: (environmentId: EnvironmentId) => {
      for (const listener of lifecycleListeners) {
        listener({
          type: "welcome",
          payload: {
            environment: {
              environmentId,
            },
          },
        });
      }
    },
  };
}

describe("createSnapshotBootstrapController", () => {
  it("deduplicates concurrent snapshot recovery requests", async () => {
    let bootstrapped = false;
    let resolveRecovery: (() => void) | undefined;
    const runSnapshotRecovery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = () => {
            bootstrapped = true;
            resolve();
          };
        }),
    );

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      runSnapshotRecovery,
    });

    const first = controller.ensureSnapshotRecovery("bootstrap");
    const second = controller.ensureSnapshotRecovery("bootstrap");

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    resolveRecovery?.();
    await Promise.all([first, second]);
  });

  it("skips recovery after the environment has already been bootstrapped", async () => {
    let bootstrapped = true;
    const runSnapshotRecovery = vi.fn(async () => undefined);

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      runSnapshotRecovery,
    });

    await controller.ensureSnapshotRecovery("bootstrap");

    expect(runSnapshotRecovery).not.toHaveBeenCalled();

    bootstrapped = false;
    await controller.ensureSnapshotRecovery("bootstrap");

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(runSnapshotRecovery).toHaveBeenCalledWith("bootstrap");
  });

  it("starts a new recovery after the previous one settles", async () => {
    let bootstrapped = false;
    let resolveFirstRecovery: (() => void) | undefined;
    let resolveSecondRecovery: (() => void) | undefined;
    const runSnapshotRecovery = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstRecovery = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecondRecovery = resolve;
          }),
      );

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      runSnapshotRecovery,
    });

    const first = controller.ensureSnapshotRecovery("bootstrap");
    const deduped = controller.ensureSnapshotRecovery("bootstrap");

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(deduped).toBe(first);

    resolveFirstRecovery?.();
    await first;

    const second = controller.ensureSnapshotRecovery("bootstrap");

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(2);

    const dedupedSecond = controller.ensureSnapshotRecovery("bootstrap");
    expect(dedupedSecond).toBe(second);
    expect(runSnapshotRecovery).toHaveBeenCalledTimes(2);

    bootstrapped = true;
    resolveSecondRecovery?.();
    await second;
  });

  it("skips new recovery requests once the environment becomes bootstrapped", async () => {
    let bootstrapped = false;
    let resolveRecovery: (() => void) | undefined;
    const runSnapshotRecovery = vi.fn(
      (_reason) =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      runSnapshotRecovery,
    });

    const firstRecovery = controller.ensureSnapshotRecovery("bootstrap");
    const dedupedRecovery = controller.ensureSnapshotRecovery("bootstrap");
    expect(dedupedRecovery).toBe(firstRecovery);

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(runSnapshotRecovery).toHaveBeenCalledWith("bootstrap");

    bootstrapped = true;
    resolveRecovery?.();
    await firstRecovery;

    await expect(controller.ensureSnapshotRecovery("bootstrap")).resolves.toBeUndefined();
    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
  });
});

describe("createOrchestrationRegistrySyncController", () => {
  it("bootstraps a snapshot for a registered environment client", async () => {
    const environmentId = EnvironmentId.makeUnsafe("env-1");
    const { client, getSnapshot } = createTestClient();
    const entry: WsRpcClientEntry = {
      knownEnvironment: {
        id: "env-1",
        label: "Remote env",
        source: "manual",
        target: {
          httpBaseUrl: "http://example.test",
          wsBaseUrl: "ws://example.test",
        },
        environmentId,
      },
      client,
      environmentId,
    };
    const syncSnapshot = vi.fn();

    const controller = createOrchestrationRegistrySyncController(
      {
        applyEventBatch: vi.fn(),
        syncSnapshot,
        applyTerminalEvent: vi.fn(),
      },
      {
        listEntries: () => [entry],
        subscribe: () => () => undefined,
      },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotSequence: 1 }),
      environmentId,
    );

    controller.dispose();
  });

  it("rejects a client that reports a different environment id after it is already bound", async () => {
    const environmentId = EnvironmentId.makeUnsafe("env-1");
    const otherEnvironmentId = EnvironmentId.makeUnsafe("env-2");
    const { client, emitWelcome } = createTestClient();
    const controller = createOrchestrationRegistrySyncController(
      {
        applyEventBatch: vi.fn(),
        syncSnapshot: vi.fn(),
        applyTerminalEvent: vi.fn(),
      },
      {
        listEntries: () => [
          {
            knownEnvironment: {
              id: "env-1",
              label: "Remote env",
              source: "manual",
              target: {
                httpBaseUrl: "http://example.test",
                wsBaseUrl: "ws://example.test",
              },
              environmentId,
            },
            client,
            environmentId,
          },
        ],
        subscribe: () => () => undefined,
      },
    );

    try {
      expect(() => emitWelcome(otherEnvironmentId)).toThrow(
        "Websocket client env-1 changed environment identity from env-1 to env-2 via server lifecycle welcome.",
      );
    } finally {
      controller.dispose();
    }
  });
});
