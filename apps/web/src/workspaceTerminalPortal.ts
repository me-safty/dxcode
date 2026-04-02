import { createContext, useContext } from "react";

type WorkspaceTerminalPortalTargets = {
  bottom: HTMLElement | null;
  right: HTMLElement | null;
};

const EMPTY_WORKSPACE_TERMINAL_PORTAL_TARGETS: WorkspaceTerminalPortalTargets = {
  bottom: null,
  right: null,
};

export const WorkspaceTerminalPortalTargetsContext = createContext<WorkspaceTerminalPortalTargets>(
  EMPTY_WORKSPACE_TERMINAL_PORTAL_TARGETS,
);

export function useWorkspaceTerminalPortalTargets(): WorkspaceTerminalPortalTargets {
  return useContext(WorkspaceTerminalPortalTargetsContext);
}
