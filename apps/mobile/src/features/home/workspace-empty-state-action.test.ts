import { describe, expect, it } from "@effect/vitest";

import type { WorkspaceState } from "../../state/workspaceModel";
import { deriveWorkspaceEmptyStateAction } from "./workspace-empty-state-action";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    latestCachedSnapshotReceivedAt: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("deriveWorkspaceEmptyStateAction", () => {
  it("prompts to add an environment when none are saved", () => {
    expect(
      deriveWorkspaceEmptyStateAction(
        workspaceState({ hasConnections: false, hasReadyEnvironment: false }),
      ),
    ).toEqual({ label: "Add environment", kind: "add-connection" });
  });

  it("opens environments when a saved environment is offline", () => {
    expect(
      deriveWorkspaceEmptyStateAction(
        workspaceState({
          hasConnections: true,
          hasReadyEnvironment: false,
          connectionState: "offline",
        }),
      ),
    ).toEqual({ label: "Open environments", kind: "open-environments" });
  });

  it("hides the action while environments are still loading", () => {
    expect(
      deriveWorkspaceEmptyStateAction(workspaceState({ isLoadingConnections: true })),
    ).toBeNull();
  });
});
