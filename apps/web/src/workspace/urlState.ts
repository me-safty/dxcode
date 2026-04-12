import { mergeWorkspaceRouteSearch, type WorkspaceRouteSearch } from "../workspaceRouteSearch";
import {
  resolveWorkspaceSurfaceFromSearch,
  serializeWorkspaceSurfaceToSearch,
} from "./surfaceDefinitions";
import { createDefaultWorkspaceState, type WorkspaceState, type WorkspaceTarget } from "./types";

export function resolveWorkspaceState(
  target: WorkspaceTarget,
  search: WorkspaceRouteSearch,
): WorkspaceState {
  const state = createDefaultWorkspaceState(target);
  const secondarySurface = resolveWorkspaceSurfaceFromSearch("secondary", target, search);

  if (!secondarySurface) {
    return state;
  }

  return {
    ...state,
    surfaces: {
      ...state.surfaces,
      secondary: secondarySurface,
    },
  };
}

export function buildWorkspaceRouteSearch<T extends Record<string, unknown>>(
  state: WorkspaceState,
  previous: T,
): T & WorkspaceRouteSearch {
  return mergeWorkspaceRouteSearch(
    previous,
    serializeWorkspaceSurfaceToSearch(state.surfaces.secondary),
  );
}
