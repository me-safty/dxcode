import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";

export type DiffSurfaceFocus =
  | { scope: "conversation" }
  | { scope: "turn"; turnId: TurnId; filePath?: string | undefined };

export type WorkspaceTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
      environmentId: ScopedThreadRef["environmentId"];
      threadId: ScopedThreadRef["threadId"];
    };

export interface WorkspaceSurfaceInputById {
  chat: WorkspaceTarget;
  diff: {
    threadRef: ScopedThreadRef;
    focus: DiffSurfaceFocus;
  };
}

export interface WorkspaceSurfacePlacementById {
  chat: "main";
  diff: "secondary";
}

export type WorkspaceSurfaceId = keyof WorkspaceSurfaceInputById;
export type WorkspaceSurfacePlacement = WorkspaceSurfacePlacementById[WorkspaceSurfaceId];

export type WorkspaceSurfaceIdForPlacement<P extends WorkspaceSurfacePlacement> = {
  [K in WorkspaceSurfaceId]: WorkspaceSurfacePlacementById[K] extends P ? K : never;
}[WorkspaceSurfaceId];

export type WorkspaceSurfaceInstance<TId extends WorkspaceSurfaceId = WorkspaceSurfaceId> =
  TId extends WorkspaceSurfaceId
    ? {
        id: TId;
        input: WorkspaceSurfaceInputById[TId];
      }
    : never;

export type WorkspaceSurfaceForPlacement<P extends WorkspaceSurfacePlacement> =
  WorkspaceSurfaceInstance<WorkspaceSurfaceIdForPlacement<P>>;

export type MainSurface = WorkspaceSurfaceForPlacement<"main">;
export type SecondarySurface = WorkspaceSurfaceForPlacement<"secondary">;

export type WorkspaceState = {
  version: 1;
  target: WorkspaceTarget;
  surfaces: {
    main: MainSurface;
    secondary: SecondarySurface | null;
  };
};

export function sameThreadRef(
  left: ScopedThreadRef | null | undefined,
  right: ScopedThreadRef | null | undefined,
): boolean {
  return left?.environmentId === right?.environmentId && left?.threadId === right?.threadId;
}

export function sameWorkspaceTarget(
  left: WorkspaceTarget | null | undefined,
  right: WorkspaceTarget | null | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "server" && right.kind === "server") {
    return sameThreadRef(left.threadRef, right.threadRef);
  }

  if (left.kind !== "draft" || right.kind !== "draft") {
    return false;
  }

  return (
    left.draftId === right.draftId &&
    left.environmentId === right.environmentId &&
    left.threadId === right.threadId
  );
}

export function sameDiffSurfaceFocus(
  left: DiffSurfaceFocus | null | undefined,
  right: DiffSurfaceFocus | null | undefined,
): boolean {
  if (!left || !right || left.scope !== right.scope) {
    return false;
  }

  if (left.scope === "conversation" && right.scope === "conversation") {
    return true;
  }

  if (left.scope !== "turn" || right.scope !== "turn") {
    return false;
  }

  return left.turnId === right.turnId && left.filePath === right.filePath;
}

export function createDefaultWorkspaceState(target: WorkspaceTarget): WorkspaceState {
  return {
    version: 1,
    target,
    surfaces: {
      main: {
        id: "chat",
        input: target,
      },
      secondary: null,
    },
  };
}
