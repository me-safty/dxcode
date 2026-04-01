import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStore } from "../store";
import {
  buildExpiredTerminalContextToastCopy,
  buildQueuedFollowUpDraft,
  canAutoDispatchQueuedFollowUp,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  followUpBehaviorShortcutLabel,
  hasServerAcknowledgedLocalDispatch,
  resolveFollowUpBehavior,
  shouldInvertFollowUpBehaviorFromKeyEvent,
  waitForStartedServerThread,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("follow-up behavior helpers", () => {
  it("inverts the configured behavior when requested", () => {
    expect(resolveFollowUpBehavior("steer", false)).toBe("steer");
    expect(resolveFollowUpBehavior("steer", true)).toBe("queue");
    expect(resolveFollowUpBehavior("queue", true)).toBe("steer");
  });

  it("detects the opposite-submit keyboard shortcut across platforms", () => {
    expect(
      shouldInvertFollowUpBehaviorFromKeyEvent(
        {
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          altKey: false,
        },
        "Win32",
      ),
    ).toBe(true);
    expect(
      shouldInvertFollowUpBehaviorFromKeyEvent(
        {
          ctrlKey: false,
          metaKey: true,
          shiftKey: true,
          altKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      shouldInvertFollowUpBehaviorFromKeyEvent(
        {
          ctrlKey: false,
          metaKey: false,
          shiftKey: true,
          altKey: false,
        },
        "Win32",
      ),
    ).toBe(false);
    expect(followUpBehaviorShortcutLabel("MacIntel")).toBe("Cmd+Shift+Enter");
    expect(followUpBehaviorShortcutLabel("Win32")).toBe("Ctrl+Shift+Enter");
  });

  it("builds a queued follow-up snapshot and auto-dispatch rules", () => {
    const snapshot = buildQueuedFollowUpDraft({
      prompt: "next step",
      attachments: [],
      terminalContexts: [
        {
          id: "ctx-1",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 1,
          lineEnd: 1,
          text: "hello",
          createdAt: "2026-03-27T12:00:00.000Z",
        },
      ],
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-03-27T12:00:00.000Z",
    });

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.terminalContexts[0]?.text).toBe("hello");
    expect(
      canAutoDispatchQueuedFollowUp({
        phase: "ready",
        queuedFollowUpCount: 2,
        queuedHeadHasError: false,
        isConnecting: false,
        isSendBusy: false,
        isRevertingCheckpoint: false,
        hasThreadError: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toBe(true);
    expect(
      canAutoDispatchQueuedFollowUp({
        phase: "running",
        queuedFollowUpCount: 2,
        queuedHeadHasError: false,
        isConnecting: false,
        isSendBusy: false,
        isRevertingCheckpoint: false,
        hasThreadError: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toBe(false);
    expect(
      canAutoDispatchQueuedFollowUp({
        phase: "ready",
        queuedFollowUpCount: 1,
        queuedHeadHasError: true,
        isConnecting: false,
        isSendBusy: false,
        isRevertingCheckpoint: false,
        hasThreadError: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toBe(false);
  });
});

const makeThread = (input?: {
  id?: ThreadId;
  latestTurn?: {
    turnId: TurnId;
    state: "running" | "completed";
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}) => ({
  id: input?.id ?? ThreadId.makeUnsafe("thread-1"),
  codexThreadId: null,
  projectId: ProjectId.makeUnsafe("project-1"),
  title: "Thread",
  modelSelection: { provider: "codex" as const, model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: null,
  messages: [],
  queuedFollowUps: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-03-29T00:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-03-29T00:00:00.000Z",
  latestTurn: input?.latestTurn
    ? {
        ...input.latestTurn,
        assistantMessageId: null,
      }
    : null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [],
  activities: [],
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useStore.setState((state) => ({
    ...state,
    projects: [],
    threads: [],
    bootstrapComplete: true,
  }));
});

describe("waitForStartedServerThread", () => {
  it("resolves immediately when the thread is already started", async () => {
    const threadId = ThreadId.makeUnsafe("thread-started");
    useStore.setState((state) => ({
      ...state,
      threads: [
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ],
    }));

    await expect(waitForStartedServerThread(threadId)).resolves.toBe(true);
  });

  it("waits for the thread to start via subscription updates", async () => {
    const threadId = ThreadId.makeUnsafe("thread-wait");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));

    const promise = waitForStartedServerThread(threadId, 500);

    useStore.setState((state) => ({
      ...state,
      threads: [
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ],
    }));

    await expect(promise).resolves.toBe(true);
  });

  it("handles the thread starting between the initial read and subscription setup", async () => {
    const threadId = ThreadId.makeUnsafe("thread-race");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));

    const originalSubscribe = useStore.subscribe.bind(useStore);
    let raced = false;
    vi.spyOn(useStore, "subscribe").mockImplementation((listener) => {
      if (!raced) {
        raced = true;
        useStore.setState((state) => ({
          ...state,
          threads: [
            makeThread({
              id: threadId,
              latestTurn: {
                turnId: TurnId.makeUnsafe("turn-race"),
                state: "running",
                requestedAt: "2026-03-29T00:00:01.000Z",
                startedAt: "2026-03-29T00:00:01.000Z",
                completedAt: null,
              },
            }),
          ],
        }));
      }
      return originalSubscribe(listener);
    });

    await expect(waitForStartedServerThread(threadId, 500)).resolves.toBe(true);
  });

  it("returns false after the timeout when the thread never starts", async () => {
    vi.useFakeTimers();

    const threadId = ThreadId.makeUnsafe("thread-timeout");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));
    const promise = waitForStartedServerThread(threadId, 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const projectId = ProjectId.makeUnsafe("project-1");
  const previousLatestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-29T00:00:00.000Z",
    startedAt: "2026-03-29T00:00:01.000Z",
    completedAt: "2026-03-29T00:00:10.000Z",
    assistantMessageId: null,
  };

  const previousSession = {
    provider: "codex" as const,
    status: "ready" as const,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:10.000Z",
    orchestrationStatus: "idle" as const,
  };

  const baseThread = {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId,
    title: "Thread",
    modelSelection: { provider: "codex" as const, model: "gpt-5.4" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    session: previousSession,
    messages: [],
    queuedFollowUps: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-29T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-29T00:00:10.000Z",
    latestTurn: previousLatestTurn,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };

  it("does not clear local dispatch before server state changes", () => {
    const localDispatch = createLocalDispatchSnapshot(baseThread);

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: previousSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch when a new turn is already settled", () => {
    const localDispatch = createLocalDispatchSnapshot(baseThread);

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.makeUnsafe("turn-2"),
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: "2026-03-29T00:01:30.000Z",
        },
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:01:30.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears local dispatch when the session changes without an observed running phase", () => {
    const localDispatch = createLocalDispatchSnapshot(baseThread);

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:00:11.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });
});
