import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export const PROJECT_HOST_TERMINAL_UNAVAILABLE_REASON =
  "Terminals are only available when a project host is connected.";
export const PROJECT_HOST_ACTION_UNAVAILABLE_REASON = "Connect the project host to run actions";

export interface ProjectHostControlAvailability {
  readonly terminalControlsAvailable: boolean;
  readonly terminalDrawerToggleAvailable: boolean;
  readonly projectActionsRunAvailable: boolean;
}

export function deriveProjectHostControlAvailability(input: {
  readonly hasActiveProject: boolean;
  readonly environmentConnectionPhase: EnvironmentConnectionPhase | null;
  readonly terminalDrawerOpen: boolean;
}): ProjectHostControlAvailability {
  const connectedProjectHost =
    input.hasActiveProject && input.environmentConnectionPhase === "connected";

  return {
    terminalControlsAvailable: connectedProjectHost,
    terminalDrawerToggleAvailable: connectedProjectHost || input.terminalDrawerOpen,
    projectActionsRunAvailable: connectedProjectHost,
  };
}
