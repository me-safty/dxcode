import type { WorkspaceRouteSearch } from "../workspaceRouteSearch";
import { parseDiffSurfaceFromSearch, serializeDiffSurfaceToSearch } from "./surfaces/diffSurface";
import {
  sameDiffSurfaceFocus,
  sameThreadRef,
  sameWorkspaceTarget,
  type SecondarySurface,
  type WorkspaceState,
  type WorkspaceSurfaceForPlacement,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfacePlacement,
  type WorkspaceTarget,
} from "./types";

export function sameWorkspaceSurface(
  left: WorkspaceSurfaceInstance | null | undefined,
  right: WorkspaceSurfaceInstance | null | undefined,
): boolean {
  if (!left || !right || left.id !== right.id) {
    return false;
  }

  switch (left.id) {
    case "chat": {
      const nextRight = right as Extract<WorkspaceSurfaceInstance, { id: "chat" }>;
      return sameWorkspaceTarget(left.input, nextRight.input);
    }
    case "diff": {
      const nextRight = right as Extract<WorkspaceSurfaceInstance, { id: "diff" }>;
      return (
        sameThreadRef(left.input.threadRef, nextRight.input.threadRef) &&
        sameDiffSurfaceFocus(left.input.focus, nextRight.input.focus)
      );
    }
  }
}

export function isWorkspaceSurfaceCompatibleWithTarget(
  surface: WorkspaceSurfaceInstance,
  target: WorkspaceTarget,
): boolean {
  switch (surface.id) {
    case "chat":
      return sameWorkspaceTarget(surface.input, target);
    case "diff":
      return target.kind === "server" && sameThreadRef(surface.input.threadRef, target.threadRef);
  }
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
  if (placement !== "secondary") {
    return null;
  }

  return parseDiffSurfaceFromSearch(target, search) as WorkspaceSurfaceForPlacement<P> | null;
}

export function serializeWorkspaceSurfaceToSearch(
  surface: WorkspaceSurfaceInstance | null,
): Partial<WorkspaceRouteSearch> {
  if (!surface) {
    return {};
  }

  switch (surface.id) {
    case "chat":
      return {};
    case "diff":
      return serializeDiffSurfaceToSearch(surface as SecondarySurface & { id: "diff" });
  }
}
