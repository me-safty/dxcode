import { isWorkspaceSurfaceCompatibleWithTarget, sameWorkspaceSurface } from "./surfaceDefinitions";
import type {
  MainSurface,
  SecondarySurface,
  WorkspaceState,
  WorkspaceSurfaceIdForPlacement,
  WorkspaceSurfaceInputById,
} from "./types";

export type WorkspaceAction =
  | {
      type: "openSurface";
      placement: "main";
      surface: MainSurface;
    }
  | {
      type: "openSurface";
      placement: "secondary";
      surface: SecondarySurface;
    }
  | {
      type: "closeSurface";
      placement: "secondary";
    }
  | {
      type: "updateSurface";
      placement: "main";
      surfaceId: WorkspaceSurfaceIdForPlacement<"main">;
      input: WorkspaceSurfaceInputById[WorkspaceSurfaceIdForPlacement<"main">];
    }
  | {
      type: "updateSurface";
      placement: "secondary";
      surfaceId: WorkspaceSurfaceIdForPlacement<"secondary">;
      input: WorkspaceSurfaceInputById[WorkspaceSurfaceIdForPlacement<"secondary">];
    };

export function reduceWorkspaceState(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "openSurface": {
      if (!isWorkspaceSurfaceCompatibleWithTarget(action.surface, state.target)) {
        return state;
      }

      if (action.placement === "main") {
        if (sameWorkspaceSurface(state.surfaces.main, action.surface)) {
          return state;
        }

        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            main: action.surface,
          },
        };
      }

      if (sameWorkspaceSurface(state.surfaces.secondary, action.surface)) {
        return state;
      }

      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          secondary: action.surface,
        },
      };
    }
    case "closeSurface":
      if (state.surfaces.secondary === null) {
        return state;
      }

      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          secondary: null,
        },
      };
    case "updateSurface": {
      if (action.placement === "main") {
        const nextSurface: MainSurface = {
          id: action.surfaceId,
          input: action.input,
        };

        if (!isWorkspaceSurfaceCompatibleWithTarget(nextSurface, state.target)) {
          return state;
        }

        if (sameWorkspaceSurface(state.surfaces.main, nextSurface)) {
          return state;
        }

        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            main: nextSurface,
          },
        };
      }

      const nextSurface: SecondarySurface = {
        id: action.surfaceId,
        input: action.input,
      };

      if (!isWorkspaceSurfaceCompatibleWithTarget(nextSurface, state.target)) {
        return state;
      }

      if (sameWorkspaceSurface(state.surfaces.secondary, nextSurface)) {
        return state;
      }

      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          secondary: nextSurface,
        },
      };
    }
  }
}
