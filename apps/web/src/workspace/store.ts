import { createStore } from "zustand/vanilla";

import { reduceWorkspaceState } from "./reducer";
import { sameWorkspaceState } from "./surfaceCatalog";
import type {
  MainSurface,
  SecondarySurface,
  WorkspaceState,
  WorkspaceSurfaceIdForPlacement,
  WorkspaceSurfaceInputById,
} from "./types";

type WorkspaceOptimisticTransition = {
  nextState: WorkspaceState;
};

export interface WorkspaceNavigationOptions {
  replace?: boolean;
}

export type OpenSurfaceFn = {
  (placement: "main", surface: MainSurface, options?: WorkspaceNavigationOptions): void;
  (placement: "secondary", surface: SecondarySurface, options?: WorkspaceNavigationOptions): void;
};

export type UpdateSurfaceFn = {
  (
    placement: "main",
    surfaceId: WorkspaceSurfaceIdForPlacement<"main">,
    input: WorkspaceSurfaceInputById[WorkspaceSurfaceIdForPlacement<"main">],
    options?: WorkspaceNavigationOptions,
  ): void;
  (
    placement: "secondary",
    surfaceId: WorkspaceSurfaceIdForPlacement<"secondary">,
    input: WorkspaceSurfaceInputById[WorkspaceSurfaceIdForPlacement<"secondary">],
    options?: WorkspaceNavigationOptions,
  ): void;
};

interface WorkspaceStoreController {
  navigateToState: (state: WorkspaceState, options?: WorkspaceNavigationOptions) => void;
}

export interface WorkspaceStoreState {
  routeState: WorkspaceState;
  optimisticTransitions: WorkspaceOptimisticTransition[];
}

export interface WorkspaceStore extends WorkspaceStoreState {
  setOptimisticState: (nextState: WorkspaceState) => void;
  syncRouteState: (routeState: WorkspaceState) => void;
  openSurface: OpenSurfaceFn;
  closeSurface: (placement: "secondary", options?: WorkspaceNavigationOptions) => void;
  updateSurface: UpdateSurfaceFn;
}

export type WorkspaceStoreApi = ReturnType<typeof createWorkspaceStore>;

export function selectResolvedWorkspaceState(state: WorkspaceStoreState): WorkspaceState {
  return state.optimisticTransitions.at(-1)?.nextState ?? state.routeState;
}

export function createWorkspaceStore(
  initialState: WorkspaceState,
  controller: WorkspaceStoreController,
) {
  return createStore<WorkspaceStore>()((set, get) => ({
    routeState: initialState,
    optimisticTransitions: [],
    setOptimisticState: (nextState) =>
      set((current) => {
        const previousTransition = current.optimisticTransitions.at(-1);
        if (previousTransition && sameWorkspaceState(previousTransition.nextState, nextState)) {
          return current;
        }

        return {
          optimisticTransitions: [
            ...current.optimisticTransitions,
            {
              nextState,
            },
          ],
        };
      }),
    syncRouteState: (routeState) =>
      set((current) => {
        if (sameWorkspaceState(current.routeState, routeState)) {
          return current;
        }

        const matchedTransitionIndex = current.optimisticTransitions.findIndex((transition) =>
          sameWorkspaceState(transition.nextState, routeState),
        );
        if (matchedTransitionIndex >= 0) {
          return {
            routeState,
            optimisticTransitions: current.optimisticTransitions.slice(matchedTransitionIndex + 1),
          };
        }

        return {
          routeState,
          optimisticTransitions: [],
        };
      }),
    openSurface: ((
      placement: "main" | "secondary",
      surface: MainSurface | SecondarySurface,
      options,
    ) => {
      const currentState = selectResolvedWorkspaceState(get());
      const nextState = reduceWorkspaceState(
        currentState,
        placement === "main"
          ? {
              type: "openSurface",
              placement,
              surface: surface as MainSurface,
            }
          : {
              type: "openSurface",
              placement,
              surface: surface as SecondarySurface,
            },
      );
      if (nextState === currentState) {
        return;
      }

      get().setOptimisticState(nextState);
      controller.navigateToState(nextState, options);
    }) as OpenSurfaceFn,
    closeSurface: (placement: "secondary", options?: WorkspaceNavigationOptions) => {
      const currentState = selectResolvedWorkspaceState(get());
      const nextState = reduceWorkspaceState(currentState, { type: "closeSurface", placement });
      if (nextState === currentState) {
        return;
      }

      get().setOptimisticState(nextState);
      controller.navigateToState(nextState, options);
    },
    updateSurface: ((
      placement: "main" | "secondary",
      surfaceId:
        | WorkspaceSurfaceIdForPlacement<"main">
        | WorkspaceSurfaceIdForPlacement<"secondary">,
      input: MainSurface["input"] | SecondarySurface["input"],
      options,
    ) => {
      const currentState = selectResolvedWorkspaceState(get());
      const nextState = reduceWorkspaceState(currentState, {
        type: "updateSurface",
        placement,
        surfaceId,
        input,
      } as
        | {
            type: "updateSurface";
            placement: "main";
            surfaceId: WorkspaceSurfaceIdForPlacement<"main">;
            input: MainSurface["input"];
          }
        | {
            type: "updateSurface";
            placement: "secondary";
            surfaceId: WorkspaceSurfaceIdForPlacement<"secondary">;
            input: SecondarySurface["input"];
          });
      if (nextState === currentState) {
        return;
      }

      get().setOptimisticState(nextState);
      controller.navigateToState(nextState, options);
    }) as UpdateSurfaceFn,
  }));
}
