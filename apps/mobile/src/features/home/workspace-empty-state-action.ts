import type { WorkspaceState } from "../../state/workspaceModel";

export type WorkspaceEmptyStateActionKind = "add-connection" | "open-environments";

export interface WorkspaceEmptyStateAction {
  readonly label: string;
  readonly kind: WorkspaceEmptyStateActionKind;
}

export function deriveWorkspaceEmptyStateAction(
  catalogState: WorkspaceState,
): WorkspaceEmptyStateAction | null {
  if (catalogState.isLoadingConnections) {
    return null;
  }

  if (!catalogState.hasConnections) {
    return { label: "Add environment", kind: "add-connection" };
  }

  if (!catalogState.hasReadyEnvironment) {
    return { label: "Open environments", kind: "open-environments" };
  }

  return null;
}
