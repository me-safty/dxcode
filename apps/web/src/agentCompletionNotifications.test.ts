import { ProjectId, ThreadId, TurnId, type OrchestrationReadModel } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW_ISO = "2026-03-16T12:00:00.000Z";

type TestThread = OrchestrationReadModel["threads"][number];
interface NotificationStubInstance {
  title: string;
  options?: NotificationOptions;
  close: () => void;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

type NotificationStub = {
  new (title: string, options?: NotificationOptions): NotificationStubInstance;
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
};

function makeThread(overrides: Partial<TestThread> = {}): TestThread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Agent thread",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeSnapshot(threads: TestThread[]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW_ISO,
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project One",
        workspaceRoot: "/repo/project-one",
        defaultModel: "gpt-5.4",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
      {
        id: ProjectId.makeUnsafe("project-2"),
        title: "Project Two",
        workspaceRoot: "/repo/project-two",
        defaultModel: "gpt-5.4",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads,
  };
}

function makeSettledTurn(
  turnId: string,
  state: "completed" | "error" | "interrupted",
  completedAt: string,
) {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state,
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  } as const;
}

function createNotificationStub(input: {
  permission: NotificationPermission;
  nextPermission?: NotificationPermission;
  onCreate?: (instance: NotificationStubInstance) => void;
}): NotificationStub {
  function FakeNotification(
    this: NotificationStubInstance,
    title: string,
    options?: NotificationOptions,
  ) {
    this.title = title;
    if (options !== undefined) {
      this.options = options;
    }
    this.close = () => undefined;
    this.addEventListener = () => undefined;
    input.onCreate?.(this);
  }

  const stub = FakeNotification as unknown as NotificationStub;
  stub.permission = input.permission;
  stub.requestPermission = vi.fn(async () => {
    const resolvedPermission = input.nextPermission ?? stub.permission;
    stub.permission = resolvedPermission;
    return resolvedPermission;
  });
  return stub;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent completion notifications", () => {
  it("seeds the initial snapshot without emitting historical notifications", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const snapshot = makeSnapshot([
      makeThread({
        latestTurn: makeSettledTurn("turn-1", "completed", "2026-03-16T12:01:00.000Z"),
      }),
    ]);

    const candidates = collectNewlySettledTurns(null, snapshot, dedupeState);

    expect(candidates).toEqual([]);
    expect(dedupeState.initialized).toBe(true);
    expect(dedupeState.settlementKeyByThreadId.get("thread-1")).toBe(
      "turn-1:2026-03-16T12:01:00.000Z:completed",
    );
  });

  it("emits a success notification when a running turn completes", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const previousSnapshot = makeSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "running",
          requestedAt: NOW_ISO,
          startedAt: NOW_ISO,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ]);
    const nextSnapshot = makeSnapshot([
      makeThread({
        latestTurn: makeSettledTurn("turn-1", "completed", "2026-03-16T12:02:00.000Z"),
      }),
    ]);

    collectNewlySettledTurns(null, previousSnapshot, dedupeState);
    const candidates = collectNewlySettledTurns(previousSnapshot, nextSnapshot, dedupeState);

    expect(candidates).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        threadTitle: "Agent thread",
        projectTitle: "Project One",
        outcome: "success",
        turnId: "turn-1",
        completedAt: "2026-03-16T12:02:00.000Z",
      }),
    ]);
  });

  it("emits an error notification when a running turn fails", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const previousSnapshot = makeSnapshot([makeThread()]);
    const nextSnapshot = makeSnapshot([
      makeThread({
        latestTurn: makeSettledTurn("turn-2", "error", "2026-03-16T12:03:00.000Z"),
      }),
    ]);

    collectNewlySettledTurns(null, previousSnapshot, dedupeState);
    const candidates = collectNewlySettledTurns(previousSnapshot, nextSnapshot, dedupeState);

    expect(candidates[0]?.outcome).toBe("error");
  });

  it("emits an interrupted notification when a running turn is interrupted", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const previousSnapshot = makeSnapshot([makeThread()]);
    const nextSnapshot = makeSnapshot([
      makeThread({
        latestTurn: makeSettledTurn("turn-3", "interrupted", "2026-03-16T12:04:00.000Z"),
      }),
    ]);

    collectNewlySettledTurns(null, previousSnapshot, dedupeState);
    const candidates = collectNewlySettledTurns(previousSnapshot, nextSnapshot, dedupeState);

    expect(candidates[0]?.outcome).toBe("interrupted");
  });

  it("does not emit duplicates when the same settled snapshot is re-synced", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const settledSnapshot = makeSnapshot([
      makeThread({
        latestTurn: makeSettledTurn("turn-4", "completed", "2026-03-16T12:05:00.000Z"),
      }),
    ]);

    collectNewlySettledTurns(null, makeSnapshot([makeThread()]), dedupeState);
    const first = collectNewlySettledTurns(null, settledSnapshot, dedupeState);
    const second = collectNewlySettledTurns(settledSnapshot, settledSnapshot, dedupeState);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("only emits newly settled turns for the thread that changed", async () => {
    const { collectNewlySettledTurns, createNotificationDedupeState } =
      await import("./agentCompletionNotifications");
    const dedupeState = createNotificationDedupeState();
    const threadOne = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      latestTurn: makeSettledTurn("turn-1", "completed", "2026-03-16T12:06:00.000Z"),
    });
    const threadTwoBefore = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: ProjectId.makeUnsafe("project-2"),
      title: "Second thread",
    });
    const threadTwoAfter = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: ProjectId.makeUnsafe("project-2"),
      title: "Second thread",
      latestTurn: makeSettledTurn("turn-2", "completed", "2026-03-16T12:07:00.000Z"),
    });

    const previousSnapshot = makeSnapshot([threadOne, threadTwoBefore]);
    const nextSnapshot = makeSnapshot([threadOne, threadTwoAfter]);

    collectNewlySettledTurns(null, previousSnapshot, dedupeState);
    const candidates = collectNewlySettledTurns(previousSnapshot, nextSnapshot, dedupeState);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.threadId).toBe("thread-2");
  });

  it("suppresses effects while the app is in the foreground", async () => {
    const notificationInstances: NotificationStubInstance[] = [];
    const playMock = vi.fn(async () => undefined);

    class FakeAudio {
      currentTime = 0;
      preload = "";
      play = playMock;
      constructor(public readonly src: string) {}
    }

    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "Notification",
      createNotificationStub({
        permission: "granted",
        onCreate: (instance) => {
          notificationInstances.push(instance);
        },
      }),
    );

    const { dispatchTurnCompletionEffects } = await import("./agentCompletionNotifications");
    await dispatchTurnCompletionEffects({
      settledTurn: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        threadTitle: "Agent thread",
        projectTitle: "Project One",
        outcome: "success",
        turnId: "turn-1",
        completedAt: "2026-03-16T12:08:00.000Z",
      },
      settings: {
        enableSystemNotifications: true,
        enableCompletionSound: true,
        notificationSoundSelection: "default",
        notificationCustomSoundId: "",
      },
      backgrounded: false,
      onOpenThread: () => undefined,
    });

    expect(notificationInstances).toHaveLength(0);
    expect(playMock).not.toHaveBeenCalled();
  });

  it("suppresses disabled channels independently", async () => {
    const notificationInstances: NotificationStubInstance[] = [];
    const playMock = vi.fn(async () => undefined);

    class FakeAudio {
      currentTime = 0;
      preload = "";
      play = playMock;
      constructor(public readonly src: string) {}
    }

    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "Notification",
      createNotificationStub({
        permission: "granted",
        onCreate: (instance) => {
          notificationInstances.push(instance);
        },
      }),
    );

    const { dispatchTurnCompletionEffects } = await import("./agentCompletionNotifications");
    const settledTurn = {
      threadId: ThreadId.makeUnsafe("thread-1"),
      threadTitle: "Agent thread",
      projectTitle: "Project One",
      outcome: "success" as const,
      turnId: "turn-1",
      completedAt: "2026-03-16T12:09:00.000Z",
    };

    await dispatchTurnCompletionEffects({
      settledTurn,
      settings: {
        enableSystemNotifications: false,
        enableCompletionSound: true,
        notificationSoundSelection: "default",
        notificationCustomSoundId: "",
      },
      backgrounded: true,
      onOpenThread: () => undefined,
    });
    expect(notificationInstances).toHaveLength(0);
    expect(playMock).toHaveBeenCalledTimes(1);

    await dispatchTurnCompletionEffects({
      settledTurn,
      settings: {
        enableSystemNotifications: true,
        enableCompletionSound: false,
        notificationSoundSelection: "default",
        notificationCustomSoundId: "",
      },
      backgrounded: true,
      onOpenThread: () => undefined,
    });
    expect(notificationInstances).toHaveLength(1);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable notifications when the Notification API is missing", async () => {
    const { getNotificationPermissionState } = await import("./agentCompletionNotifications");

    expect(getNotificationPermissionState()).toBe("unavailable");
  });

  it("returns denied when browser permission is blocked", async () => {
    vi.stubGlobal(
      "Notification",
      createNotificationStub({
        permission: "denied",
        nextPermission: "denied",
      }),
    );

    const { getNotificationPermissionState, requestNotificationPermission } =
      await import("./agentCompletionNotifications");

    expect(getNotificationPermissionState()).toBe("denied");
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  it("resolves custom sound sources when configured", async () => {
    const resolveCustomNotificationSoundSrc = vi.fn(async () => "blob:custom-sound");
    vi.doMock("./notificationSoundStorage", () => ({
      resolveCustomNotificationSoundSrc,
    }));

    const { resolveCompletionSoundSrc } = await import("./agentCompletionNotifications");

    await expect(
      resolveCompletionSoundSrc({
        enableCompletionSound: true,
        notificationSoundSelection: "custom",
        notificationCustomSoundId: "custom-sound-1",
      }),
    ).resolves.toBe("blob:custom-sound");
    expect(resolveCustomNotificationSoundSrc).toHaveBeenCalledWith("custom-sound-1");

    await expect(
      resolveCompletionSoundSrc({
        enableCompletionSound: false,
        notificationSoundSelection: "custom",
        notificationCustomSoundId: "custom-sound-1",
      }),
    ).resolves.toBeNull();
  });

  it("does not play the default sound when configured playback is disabled", async () => {
    const playMock = vi.fn(async () => undefined);

    class FakeAudio {
      currentTime = 0;
      preload = "";
      play = playMock;
      constructor(public readonly src: string) {}
    }

    vi.stubGlobal("Audio", FakeAudio);

    const { playConfiguredCompletionSound } = await import("./agentCompletionNotifications");

    await playConfiguredCompletionSound({
      enableCompletionSound: false,
      notificationSoundSelection: "default",
      notificationCustomSoundId: "",
    });

    expect(playMock).not.toHaveBeenCalled();
  });
});
