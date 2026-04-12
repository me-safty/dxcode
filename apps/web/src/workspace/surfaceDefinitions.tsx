import type { ReactNode } from "react";

import type { WorkspaceRouteSearch } from "../workspaceRouteSearch";
import { chatSurfaceDefinition } from "./surfaces/chatSurface";
import { diffSurfaceDefinition } from "./surfaces/diffSurface";
import {
  sameWorkspaceTarget,
  type MainSurface,
  type SecondarySurface,
  type WorkspaceState,
  type WorkspaceSurfaceForPlacement,
  type WorkspaceSurfaceId,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfacePlacement,
  type WorkspaceSurfacePlacementById,
  type WorkspaceTarget,
} from "./types";

export type WorkspaceSurfaceRenderMode = "inline" | "sidebar" | "sheet";

export interface WorkspaceSurfaceDefinition<TId extends WorkspaceSurfaceId> {
  id: TId;
  placement: WorkspaceSurfacePlacementById[TId];
  isEqual: (left: WorkspaceSurfaceInstance<TId>, right: WorkspaceSurfaceInstance<TId>) => boolean;
  isCompatibleWithTarget: (
    surface: WorkspaceSurfaceInstance<TId>,
    target: WorkspaceTarget,
  ) => boolean;
  render: (
    surface: WorkspaceSurfaceInstance<TId>,
    renderMode: WorkspaceSurfaceRenderMode,
  ) => ReactNode;
  resolveFromSearch: (
    target: WorkspaceTarget,
    search: WorkspaceRouteSearch,
  ) => WorkspaceSurfaceInstance<TId> | null;
  serializeToSearch: (surface: WorkspaceSurfaceInstance<TId>) => Partial<WorkspaceRouteSearch>;
}

export const workspaceSurfaceDefinitions = {
  chat: chatSurfaceDefinition,
  diff: diffSurfaceDefinition,
} satisfies {
  [K in WorkspaceSurfaceId]: WorkspaceSurfaceDefinition<K>;
};

function getWorkspaceSurfaceDefinition<TId extends WorkspaceSurfaceId>(
  surfaceId: TId,
): WorkspaceSurfaceDefinition<TId> {
  return workspaceSurfaceDefinitions[surfaceId] as unknown as WorkspaceSurfaceDefinition<TId>;
}

export function sameWorkspaceSurface(
  left: WorkspaceSurfaceInstance | null | undefined,
  right: WorkspaceSurfaceInstance | null | undefined,
): boolean {
  if (!left || !right || left.id !== right.id) {
    return false;
  }

  const definition = getWorkspaceSurfaceDefinition(left.id);
  return definition.isEqual(
    left as WorkspaceSurfaceInstance<typeof left.id>,
    right as WorkspaceSurfaceInstance<typeof left.id>,
  );
}

export function isWorkspaceSurfaceCompatibleWithTarget(
  surface: WorkspaceSurfaceInstance,
  target: WorkspaceTarget,
): boolean {
  return getWorkspaceSurfaceDefinition(surface.id).isCompatibleWithTarget(
    surface as WorkspaceSurfaceInstance<typeof surface.id>,
    target,
  );
}

export function sameWorkspaceState(
  left: WorkspaceState | null | undefined,
  right: WorkspaceState | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.version === right.version &&
    sameWorkspaceTarget(left.target, right.target) &&
    sameWorkspaceSurface(left.surfaces.main, right.surfaces.main) &&
    ((left.surfaces.secondary === null && right.surfaces.secondary === null) ||
      sameWorkspaceSurface(left.surfaces.secondary, right.surfaces.secondary)),
  );
}

export function resolveWorkspaceSurfaceFromSearch<P extends WorkspaceSurfacePlacement>(
  placement: P,
  target: WorkspaceTarget,
  search: WorkspaceRouteSearch,
): WorkspaceSurfaceForPlacement<P> | null {
  for (const definition of Object.values(workspaceSurfaceDefinitions)) {
    if (definition.placement !== placement) {
      continue;
    }

    const surface = definition.resolveFromSearch(target, search);
    if (surface) {
      return surface as WorkspaceSurfaceForPlacement<P>;
    }
  }

  return null;
}

export function serializeWorkspaceSurfaceToSearch(
  surface: WorkspaceSurfaceInstance | null,
): Partial<WorkspaceRouteSearch> {
  if (!surface) {
    return {};
  }

  return getWorkspaceSurfaceDefinition(surface.id).serializeToSearch(
    surface as WorkspaceSurfaceInstance<typeof surface.id>,
  );
}

export function renderWorkspaceSurface(
  surface: WorkspaceSurfaceInstance,
  renderMode: WorkspaceSurfaceRenderMode,
): ReactNode {
  return getWorkspaceSurfaceDefinition(surface.id).render(
    surface as WorkspaceSurfaceInstance<typeof surface.id>,
    renderMode,
  );
}

export function renderMainSurface(surface: MainSurface): ReactNode {
  return renderWorkspaceSurface(surface, "inline");
}

export function renderSecondarySurface(
  surface: SecondarySurface,
  renderMode: Exclude<WorkspaceSurfaceRenderMode, "inline">,
): ReactNode {
  return renderWorkspaceSurface(surface, renderMode);
}
