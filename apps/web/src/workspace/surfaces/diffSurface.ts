import { type ScopedThreadRef, TurnId as TurnIdSchema, type TurnId } from "@t3tools/contracts";

import {
  normalizeWorkspaceRouteSearchString,
  type WorkspaceRouteSearch,
} from "../../workspaceRouteSearch";
import type { SecondarySurface, WorkspaceTarget } from "../types";

export type DiffSurface = Extract<SecondarySurface, { id: "diff" }>;

export function createConversationDiffSurface(threadRef: ScopedThreadRef): DiffSurface {
  return {
    id: "diff",
    input: {
      threadRef,
      focus: { scope: "conversation" },
    },
  };
}

export function createTurnDiffSurface(
  threadRef: ScopedThreadRef,
  turnId: TurnId,
  filePath?: string,
): DiffSurface {
  return {
    id: "diff",
    input: {
      threadRef,
      focus: filePath ? { scope: "turn", turnId, filePath } : { scope: "turn", turnId },
    },
  };
}

export function parseDiffSurfaceFromSearch(
  target: WorkspaceTarget,
  search: WorkspaceRouteSearch,
): DiffSurface | null {
  if (target.kind !== "server" || search.panel !== "diff") {
    return null;
  }

  const turnIdRaw = normalizeWorkspaceRouteSearchString(search.panelTurnId);
  const turnId = turnIdRaw ? TurnIdSchema.make(turnIdRaw) : undefined;
  const filePath =
    turnId !== undefined ? normalizeWorkspaceRouteSearchString(search.panelFilePath) : undefined;

  return turnId !== undefined
    ? createTurnDiffSurface(target.threadRef, turnId, filePath)
    : createConversationDiffSurface(target.threadRef);
}

export function serializeDiffSurfaceToSearch(surface: DiffSurface): Partial<WorkspaceRouteSearch> {
  return {
    panel: "diff",
    ...(surface.input.focus.scope === "turn"
      ? {
          panelTurnId: surface.input.focus.turnId,
          ...(surface.input.focus.filePath ? { panelFilePath: surface.input.focus.filePath } : {}),
        }
      : {}),
  };
}
