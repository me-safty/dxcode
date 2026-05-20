import {
  EMPTY_ORCHESTRATION_THREAD_DETAIL_PAGE_INFO,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";
import type { WsRpcProtocolClient } from "./protocol";

vi.mock("./wsTransport", () => ({
  WsTransport: class WsTransport {
    dispose = vi.fn(async () => undefined);
    reconnect = vi.fn(async () => undefined);
    request = vi.fn();
    requestStream = vi.fn();
    subscribe = vi.fn(() => () => undefined);
  },
}));

import { createWsRpcClient } from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

describe("wsRpcClient", () => {
  it("forwards orchestration sync probes through the websocket transport", async () => {
    const result = {
      clientSequence: 4,
      serverSequence: 7,
      behind: true,
    };
    const protocolProbeSync = vi.fn(() => Effect.succeed(result));
    const protocolClient = {
      [ORCHESTRATION_WS_METHODS.probeSync]: protocolProbeSync,
    } as unknown as WsRpcProtocolClient;
    const request = vi.fn(
      async <TSuccess>(
        execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
      ) => Effect.runPromise(execute(protocolClient)),
    );
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      isHeartbeatFresh: vi.fn(() => true),
      request: request as WsTransport["request"],
      requestStream: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "isHeartbeatFresh" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);

    await expect(client.orchestration.probeSync({ clientSequence: 4 })).resolves.toEqual(result);

    expect(request).toHaveBeenCalledTimes(1);
    expect(protocolProbeSync).toHaveBeenCalledWith({ clientSequence: 4 });
  });

  it("forwards thread detail page requests through the websocket transport", async () => {
    const threadId = ThreadId.make("thread-page");
    const result = {
      snapshotSequence: 7,
      thread: {
        id: threadId,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      pageInfo: EMPTY_ORCHESTRATION_THREAD_DETAIL_PAGE_INFO,
    };
    const protocolGetThreadDetailPage = vi.fn(() => Effect.succeed(result));
    const protocolClient = {
      [ORCHESTRATION_WS_METHODS.getThreadDetailPage]: protocolGetThreadDetailPage,
    } as unknown as WsRpcProtocolClient;
    const request = vi.fn(
      async <TSuccess>(
        execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
      ) => Effect.runPromise(execute(protocolClient)),
    );
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      isHeartbeatFresh: vi.fn(() => true),
      request: request as WsTransport["request"],
      requestStream: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "isHeartbeatFresh" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const input = {
      threadId,
      page: {
        before: {
          messages: {
            id: "message-10",
            createdAt: "2026-04-13T00:00:10.000Z",
          },
        },
        limits: {
          messages: 25,
        },
      },
    };

    await expect(client.orchestration.getThreadDetailPage(input)).resolves.toEqual(result);

    expect(request).toHaveBeenCalledTimes(1);
    expect(protocolGetThreadDetailPage).toHaveBeenCalledWith(input);
  });

  it("reduces vcs status stream events into flat status snapshots", () => {
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
      ] satisfies VcsStatusStreamEvent[]) {
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

    client.vcs.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          aheadOfDefaultCount: 0,
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
});
