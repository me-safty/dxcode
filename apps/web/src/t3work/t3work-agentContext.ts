import type { AddToChatTarget } from "~/t3work/hooks/t3work-useAddToChat";
import type { AddToChatRequest } from "~/t3work/t3work-addToChatUtils";
import type {
  T3WorkSidebarPinnedItem,
  T3WorkSidebarPinActionState,
} from "~/t3work/t3work-sidebarPinningTypes";

export type AgentContextToolDefinition = {
  id: string;
  label: string;
  description?: string;
};

export type AgentContextActionDefinition =
  | {
      id: string;
      label: string;
      kind: "add-to-chat";
      request: AddToChatRequest;
    }
  | {
      id: string;
      label: string;
      kind: "pin-to-sidebar";
      item: T3WorkSidebarPinnedItem;
    }
  | {
      id: string;
      label: string;
      kind: "unpin-from-sidebar";
      item: T3WorkSidebarPinnedItem;
    };

export type AgentContextCapabilities = {
  actions: readonly AgentContextActionDefinition[];
  tools?: readonly AgentContextToolDefinition[];
};

export type AgentContextActionRunOptions = {
  addToChatTarget?: AddToChatTarget;
};

export function getSidebarItemFromAgentContextCapabilities(
  capabilities: AgentContextCapabilities,
): T3WorkSidebarPinnedItem | null {
  for (const action of capabilities.actions) {
    if (action.kind === "pin-to-sidebar" || action.kind === "unpin-from-sidebar") {
      return action.item;
    }
  }

  return null;
}

export function buildAddToChatAgentContextCapabilities(
  request: AddToChatRequest,
  options?: {
    sidebarPin?: T3WorkSidebarPinActionState;
  },
): AgentContextCapabilities {
  const actions: AgentContextActionDefinition[] = [
    {
      id: "add-to-chat",
      label: "Add to chat",
      kind: "add-to-chat",
      request,
    },
  ];

  if (options?.sidebarPin) {
    const showUnpinAction = options.sidebarPin.pinned || options.sidebarPin.visibleInSidebar;
    actions.push(
      showUnpinAction
        ? {
            id: "unpin",
            label: options.sidebarPin.unpinLabel ?? "Unpin",
            kind: "unpin-from-sidebar",
            item: options.sidebarPin.item,
          }
        : {
            id: "pin-to-left",
            label: options.sidebarPin.pinLabel ?? "Pin to left",
            kind: "pin-to-sidebar",
            item: options.sidebarPin.item,
          },
    );
  }

  return {
    actions,
  };
}
