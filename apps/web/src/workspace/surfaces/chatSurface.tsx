import ChatView from "../../components/ChatView";
import type { WorkspaceRouteSearch } from "../../workspaceRouteSearch";
import { sameWorkspaceTarget, type WorkspaceTarget, type WorkspaceSurfaceInstance } from "../types";
import type { WorkspaceSurfaceDefinition } from "../surfaceDefinitions";

export type ChatSurface = WorkspaceSurfaceInstance<"chat">;

export const chatSurfaceDefinition: WorkspaceSurfaceDefinition<"chat"> = {
  id: "chat",
  placement: "main",
  isEqual: (left, right) => sameWorkspaceTarget(left.input, right.input),
  isCompatibleWithTarget: (surface, target) => sameWorkspaceTarget(surface.input, target),
  render: (surface) =>
    surface.input.kind === "server" ? (
      <ChatView
        environmentId={surface.input.threadRef.environmentId}
        threadId={surface.input.threadRef.threadId}
        routeKind="server"
      />
    ) : (
      <ChatView
        draftId={surface.input.draftId}
        environmentId={surface.input.environmentId}
        threadId={surface.input.threadId}
        routeKind="draft"
      />
    ),
  resolveFromSearch: (_target: WorkspaceTarget, _search: WorkspaceRouteSearch) => null,
  serializeToSearch: () => ({}),
};
