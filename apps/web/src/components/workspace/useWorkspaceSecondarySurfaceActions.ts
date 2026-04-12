import { useCallback, useMemo } from "react";

import { type WorkspaceNavigationOptions } from "~/workspace/store";
import { sameWorkspaceSurface } from "~/workspace/surfaceDefinitions";
import type {
  SecondarySurface,
  WorkspaceSurfaceIdForPlacement,
  WorkspaceSurfaceInputById,
} from "~/workspace/types";
import { useWorkspaceActions, useWorkspaceSecondarySurface } from "./WorkspaceProvider";

export function useWorkspaceSecondarySurfaceActions(): {
  openSecondarySurface: (surface: SecondarySurface, options?: WorkspaceNavigationOptions) => void;
  closeSecondarySurface: (options?: WorkspaceNavigationOptions) => void;
  toggleSecondarySurface: (surface: SecondarySurface, options?: WorkspaceNavigationOptions) => void;
  updateSecondarySurface: <TId extends WorkspaceSurfaceIdForPlacement<"secondary">>(
    surfaceId: TId,
    input: WorkspaceSurfaceInputById[TId],
    options?: WorkspaceNavigationOptions,
  ) => void;
} {
  const secondarySurface = useWorkspaceSecondarySurface();
  const { closeSurface, openSurface, updateSurface } = useWorkspaceActions();

  const openSecondarySurface = useCallback(
    (surface: SecondarySurface, options?: WorkspaceNavigationOptions) => {
      openSurface("secondary", surface, options);
    },
    [openSurface],
  );

  const closeSecondarySurface = useCallback(
    (options?: WorkspaceNavigationOptions) => {
      closeSurface("secondary", options);
    },
    [closeSurface],
  );

  const toggleSecondarySurface = useCallback(
    (surface: SecondarySurface, options?: WorkspaceNavigationOptions) => {
      if (sameWorkspaceSurface(secondarySurface, surface)) {
        closeSurface("secondary", options);
        return;
      }

      openSurface("secondary", surface, options);
    },
    [closeSurface, openSurface, secondarySurface],
  );

  const updateSecondarySurface = useCallback(
    <TId extends WorkspaceSurfaceIdForPlacement<"secondary">>(
      surfaceId: TId,
      input: WorkspaceSurfaceInputById[TId],
      options?: WorkspaceNavigationOptions,
    ) => {
      updateSurface("secondary", surfaceId, input, options);
    },
    [updateSurface],
  );

  return useMemo(
    () => ({
      openSecondarySurface,
      closeSecondarySurface,
      toggleSecondarySurface,
      updateSecondarySurface,
    }),
    [closeSecondarySurface, openSecondarySurface, toggleSecondarySurface, updateSecondarySurface],
  );
}
