import { type ScopedThreadRef, TurnId as TurnIdSchema, type TurnId } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

import {
  normalizeWorkspaceRouteSearchString,
  type WorkspaceRouteSearch,
} from "../../workspaceRouteSearch";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../../components/DiffPanelShell";
import type { WorkspaceSurfaceDefinition } from "../surfaceDefinitions";
import {
  sameDiffSurfaceFocus,
  sameThreadRef,
  type SecondarySurface,
  type WorkspaceTarget,
} from "../types";

export type DiffSurface = Extract<SecondarySurface, { id: "diff" }>;

const LazyRegisteredDiffSurface = lazy(() => import("./RegisteredDiffSurface"));

function DiffFallback(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

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

export const diffSurfaceDefinition: WorkspaceSurfaceDefinition<"diff"> = {
  id: "diff",
  placement: "secondary",
  isEqual: (left, right) =>
    sameThreadRef(left.input.threadRef, right.input.threadRef) &&
    sameDiffSurfaceFocus(left.input.focus, right.input.focus),
  isCompatibleWithTarget: (surface, target) =>
    target.kind === "server" && sameThreadRef(surface.input.threadRef, target.threadRef),
  render: (surface, renderMode) => (
    <Suspense fallback={<DiffFallback mode={renderMode === "sheet" ? "sheet" : "sidebar"} />}>
      <LazyRegisteredDiffSurface
        surface={surface}
        renderMode={renderMode === "sheet" ? "sheet" : "sidebar"}
      />
    </Suspense>
  ),
  resolveFromSearch: (target, search) => parseDiffSurfaceFromSearch(target, search),
  serializeToSearch: (surface) => serializeDiffSurfaceToSearch(surface),
};
