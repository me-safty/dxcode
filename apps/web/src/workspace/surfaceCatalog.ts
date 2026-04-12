import { TurnId } from "@t3tools/contracts";

import {
  normalizeWorkspaceRouteSearchString,
  type WorkspaceRouteSearch,
} from "../workspaceRouteSearch";
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

export const WORKSPACE_ROUTE_SEARCH_KEYS = ["panel", "panelTurnId", "panelFilePath"] as const;

function parseDiffSurfaceFromSearch(
  target: WorkspaceTarget,
  search: WorkspaceRouteSearch,
): SecondarySurface | null {
  if (target.kind !== "server" || search.panel !== "diff") {
    return null;
  }

  const turnIdRaw = normalizeWorkspaceRouteSearchString(search.panelTurnId);
  const turnId = turnIdRaw ? TurnId.make(turnIdRaw) : undefined;
  const filePath =
    turnId !== undefined ? normalizeWorkspaceRouteSearchString(search.panelFilePath) : undefined;

  return {
    id: "diff",
    input: {
      threadRef: target.threadRef,
      focus:
        turnId !== undefined
          ? {
              scope: "turn",
              turnId,
              ...(filePath ? { filePath } : {}),
            }
          : { scope: "conversation" },
    },
  };
}

function serializeDiffSurfaceToSearch(surface: Extract<WorkspaceSurfaceInstance, { id: "diff" }>) {
  return {
    panel: "diff",
    ...(surface.input.focus.scope === "turn"
      ? {
          panelTurnId: surface.input.focus.turnId,
          ...(surface.input.focus.filePath ? { panelFilePath: surface.input.focus.filePath } : {}),
        }
      : {}),
  } satisfies Partial<WorkspaceRouteSearch>;
}

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
      return serializeDiffSurfaceToSearch(surface);
  }
}
