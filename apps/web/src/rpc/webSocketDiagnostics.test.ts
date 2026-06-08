import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { useLocalDispatchStore } from "../localDispatchStore";
import { type EnvironmentState, useStore } from "../store";
import {
  recordTerminalDiagnostic,
  recordTerminalInputReceived,
  recordTerminalWriteStart,
  recordTerminalWriteSuccess,
  resetTerminalDiagnosticsForTests,
} from "../lib/terminalDiagnosticsState";
import { useTerminalStateStore } from "../terminalStateStore";
import {
  recordWsConnectionAttempt,
  recordWsConnectionOpened,
  recordWsHeartbeatPing,
  recordWsHeartbeatPong,
  resetWsConnectionStateForTests,
} from "./wsConnectionState";
import { buildWebSocketDiagnosticsReport } from "./webSocketDiagnostics";

describe("webSocketDiagnostics", () => {
  const environmentId = EnvironmentId.make("environment-diagnostics");
  const threadId = ThreadId.make("thread-diagnostics");
  const projectId = ProjectId.make("project-diagnostics");
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
    options: [],
  };

  function makeEnvironmentStateWithThread(): EnvironmentState {
    return {
      projectIds: [projectId],
      projectById: {
        [projectId]: {
          id: projectId,
          environmentId,
          name: "Diagnostics project",
          cwd: "/workspace/project",
          defaultModelSelection: modelSelection,
          createdAt: "2026-04-03T20:00:00.000Z",
          updatedAt: "2026-04-03T20:00:00.000Z",
          scripts: [],
        },
      },
      threadIds: [threadId],
      threadIdsByProjectId: {
        [projectId]: [threadId],
      },
      threadShellById: {
        [threadId]: {
          id: threadId,
          environmentId,
          codexThreadId: null,
          projectId,
          title: "Diagnostics thread",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          error: null,
          createdAt: "2026-04-03T20:00:00.000Z",
          archivedAt: null,
          updatedAt: "2026-04-03T20:29:00.000Z",
          branch: "main",
          worktreePath: "/workspace/project",
        },
      },
      threadSessionById: {
        [threadId]: null,
      },
      threadTurnStateById: {
        [threadId]: {
          latestTurn: null,
        },
      },
      messageIdsByThreadId: {
        [threadId]: [],
      },
      messageByThreadId: {
        [threadId]: {},
      },
      queuedTurnIdsByThreadId: {
        [threadId]: [],
      },
      queuedTurnByThreadId: {
        [threadId]: {},
      },
      activityIdsByThreadId: {
        [threadId]: [],
      },
      activityByThreadId: {
        [threadId]: {},
      },
      proposedPlanIdsByThreadId: {
        [threadId]: [],
      },
      proposedPlanByThreadId: {
        [threadId]: {},
      },
      turnDiffIdsByThreadId: {
        [threadId]: [],
      },
      turnDiffSummaryByThreadId: {
        [threadId]: {},
      },
      threadDetailPageInfoByThreadId: {},
      sidebarThreadSummaryById: {},
      bootstrapComplete: true,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T20:30:00.000Z"));
    resetWsConnectionStateForTests();
    resetTerminalDiagnosticsForTests();
    useStore.setState({
      accountRateLimitsByInstanceId: {},
      activeEnvironmentId: environmentId,
      environmentStateById: {},
    });
    useLocalDispatchStore.setState({
      localDispatchByThreadKey: {},
    });
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyActiveProvider: null,
      stickyModelSelectionByProvider: {},
    });
    useTerminalStateStore.setState({
      nextTerminalEventId: 1,
      terminalEventEntriesByKey: {},
      terminalLaunchContextByThreadKey: {},
      terminalStateByThreadKey: {},
    });
  });

  it("builds a redacted markdown note with websocket and terminal state", () => {
    recordWsConnectionAttempt("ws://localhost:3020/?token=secret-token");
    recordWsConnectionOpened();
    recordWsHeartbeatPing();
    recordWsHeartbeatPong();
    useTerminalStateStore.getState().applyTerminalEvent(
      { environmentId, threadId },
      {
        createdAt: "2026-04-03T20:30:01.000Z",
        snapshot: {
          cwd: "/workspace/project",
          exitCode: null,
          exitSignal: null,
          history: "terminal output that should not appear",
          pid: 123,
          status: "running",
          terminalId: "default",
          threadId,
          updatedAt: "2026-04-03T20:30:01.000Z",
          worktreePath: null,
        },
        terminalId: "default",
        threadId,
        type: "started",
      },
    );
    recordTerminalInputReceived({
      data: "npm run command-that-must-not-leak",
      source: "xterm-on-data",
      terminalId: "default",
      threadRef: { environmentId, threadId },
    });
    const writeAttempt = recordTerminalWriteStart({
      data: "npm run command-that-must-not-leak",
      source: "xterm-on-data",
      terminalId: "default",
      threadRef: { environmentId, threadId },
    });
    recordTerminalWriteSuccess({
      attempt: writeAttempt,
      terminalId: "default",
      threadRef: { environmentId, threadId },
    });
    recordTerminalDiagnostic({ environmentId, threadId }, "default", "terminal-resync-started", {
      reason: "toolbar",
    });
    recordTerminalDiagnostic({ environmentId, threadId }, "default", "terminal-resync-failed", {
      message: "Terminal resync failed",
    });
    recordTerminalDiagnostic({ environmentId, threadId }, "default", "terminal-restart-confirmed", {
      reason: "toolbar",
    });

    const report = buildWebSocketDiagnosticsReport({
      activeProjectName: "project",
      activeThreadEnvironmentId: environmentId,
      activeThreadId: threadId,
      activeThreadTitle: "Diagnostics thread",
      diffOpen: false,
      fileExplorerAvailable: true,
      fileExplorerOpen: false,
      gitCwd: "/workspace/project",
      openInCwd: "/workspace/project",
      sourceControlOpen: false,
      terminalAvailable: true,
      terminalOpen: true,
    });

    expect(report).toContain("# WebSocket diagnostics note");
    expect(report).toContain("## WebSocket summary");
    expect(report).toContain("## Terminal client summary");
    expect(report).toContain("## Raw snapshot");
    expect(report).toContain('"uiState": "connected"');
    expect(report).toContain('"heartbeatPingCount": 1');
    expect(report).toContain('"historyBytes": 38');
    expect(report).toContain('"inputKind": "paste-or-composition"');
    expect(report).toContain('"write-success": 1');
    expect(report).toContain("Terminal recovery state: manual-restarting");
    expect(report).toContain("writes since last output=1");
    expect(report).toContain('"terminal-resync-failed": 1');
    expect(report).toContain('"terminal-restart-confirmed": 1');
    expect(report).toContain("manual terminal resync attempt(s) failed");
    expect(report).not.toContain("secret-token");
    expect(report).not.toContain("terminal output that should not appear");
    expect(report).not.toContain("command-that-must-not-leak");
  });

  it("reports active thread identity when the server sidebar summary is missing", () => {
    const activeRef = scopeThreadRef(environmentId, threadId);
    const activeThreadKey = scopedThreadKey(activeRef);
    useStore.setState({
      activeEnvironmentId: environmentId,
      environmentStateById: {
        [environmentId]: makeEnvironmentStateWithThread(),
      },
    });
    useLocalDispatchStore.setState({
      localDispatchByThreadKey: {
        [activeThreadKey]: {
          startedAt: "2026-04-03T20:30:00.000Z",
          preparingWorktree: false,
          latestTurnTurnId: null,
          latestTurnRequestedAt: "2026-04-03T20:30:00.000Z",
          latestTurnStartedAt: null,
          latestTurnCompletedAt: null,
        },
      },
    });
    useComposerDraftStore.setState({
      draftsByThreadKey: {
        "draft-diagnostics": {
          prompt: "secret prompt that must not leak",
          images: [],
          nonPersistedImageIds: [],
          persistedAttachments: [],
          terminalContexts: [],
          modelSelectionByProvider: {},
          activeProvider: null,
          runtimeMode: null,
          interactionMode: null,
        },
      },
      draftThreadsByThreadKey: {
        "draft-diagnostics": {
          threadId,
          environmentId,
          projectId,
          logicalProjectKey: "diagnostics-project",
          createdAt: "2026-04-03T20:00:00.000Z",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: "/workspace/project",
          envMode: "local",
          sourceProposedPlan: null,
          promotedTo: activeRef,
        },
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: {
        "diagnostics-project": "draft-diagnostics",
      },
    });

    const report = buildWebSocketDiagnosticsReport({
      activeProjectName: "project",
      activeThreadEnvironmentId: environmentId,
      activeThreadId: threadId,
      activeThreadTitle: "Diagnostics thread",
      diffOpen: false,
      fileExplorerAvailable: true,
      fileExplorerOpen: false,
      gitCwd: "/workspace/project",
      openInCwd: "/workspace/project",
      sourceControlOpen: false,
      terminalAvailable: true,
      terminalOpen: true,
    });

    expect(report).toContain('"activeThreadInThreadIds": true');
    expect(report).toContain('"activeThreadInProjectThreadIds": true');
    expect(report).toContain('"activeThreadHasSidebarSummary": false');
    expect(report).toContain('"activeThreadSidebarSummary": null');
    expect(report).toContain('"missingSidebarSummaryThreadIds": [');
    expect(report).toContain(`"${threadId}"`);
    expect(report).toContain('"activeLocalDispatch":');
    expect(report).toContain('"startedAt": "2026-04-03T20:30:00.000Z"');
    expect(report).toContain('"promotedDraftsMissingSidebarSummaryCount": 1');
    expect(report).toContain(
      "Active thread exists but does not have an authoritative sidebar summary yet.",
    );
    expect(report).toContain(
      "1 promoted draft thread(s) are waiting for server sidebar summaries.",
    );
    expect(report).not.toContain("secret prompt that must not leak");
    expect(report).not.toContain("terminal output that should not appear");
  });
});
