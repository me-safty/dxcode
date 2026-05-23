import { useCallback } from "react";
import type { MouseEvent } from "react";

import { readLocalApi } from "~/localApi";
import { useAddToChat } from "~/t3work/hooks/t3work-useAddToChat";
import { useT3WorkPinnedSidebarStore } from "~/t3work/t3work-pinnedSidebarStore";
import { useT3WorkSidebarNavPreferencesStore } from "~/t3work/t3work-sidebarNavPreferencesStore";
import type {
  AgentContextActionRunOptions,
  AgentContextCapabilities,
} from "~/t3work/t3work-agentContext";

function mapContextMenuActions(capabilities: AgentContextCapabilities) {
  return capabilities.actions.map((action) => ({ id: action.id, label: action.label }));
}

export function useAgentContext() {
  const { addToChatFromRequest } = useAddToChat();
  const pinItem = useT3WorkPinnedSidebarStore((state) => state.pinItem);
  const unpinItem = useT3WorkPinnedSidebarStore((state) => state.unpinItem);
  const showSidebarItem = useT3WorkSidebarNavPreferencesStore((state) => state.showItem);
  const hideSidebarItem = useT3WorkSidebarNavPreferencesStore((state) => state.hideItem);

  const runAgentContextAction = useCallback(
    async (
      capabilities: AgentContextCapabilities,
      actionId: string,
      options?: AgentContextActionRunOptions,
    ): Promise<boolean> => {
      const action = capabilities.actions.find((candidate) => candidate.id === actionId);
      if (!action) {
        return false;
      }

      switch (action.kind) {
        case "add-to-chat": {
          await addToChatFromRequest(action.request, options?.addToChatTarget);
          return true;
        }
        case "pin-to-sidebar": {
          pinItem(action.item);
          showSidebarItem(action.item.projectId, action.item.id);
          return true;
        }
        case "unpin-from-sidebar": {
          unpinItem(action.item.id);
          hideSidebarItem(action.item.projectId, action.item.id);
          return true;
        }
      }
    },
    [addToChatFromRequest, hideSidebarItem, pinItem, showSidebarItem, unpinItem],
  );

  const showAgentContextMenuAt = useCallback(
    async (input: {
      capabilities: AgentContextCapabilities;
      x: number;
      y: number;
      options?: AgentContextActionRunOptions;
    }): Promise<boolean> => {
      if (input.capabilities.actions.length === 0) {
        return false;
      }

      const localApi = readLocalApi();
      if (!localApi) {
        return false;
      }

      const actionId = await localApi.contextMenu.show(mapContextMenuActions(input.capabilities), {
        x: input.x,
        y: input.y,
      });
      if (!actionId) {
        return false;
      }

      return runAgentContextAction(input.capabilities, actionId, input.options);
    },
    [runAgentContextAction],
  );

  const showAgentContextMenu = useCallback(
    async (
      event: MouseEvent,
      capabilities: AgentContextCapabilities,
      options?: AgentContextActionRunOptions,
    ): Promise<boolean> => {
      event.preventDefault();
      event.stopPropagation();

      return showAgentContextMenuAt({
        capabilities,
        x: event.clientX,
        y: event.clientY,
        ...(options ? { options } : {}),
      });
    },
    [showAgentContextMenuAt],
  );

  return {
    runAgentContextAction,
    showAgentContextMenu,
    showAgentContextMenuAt,
  };
}
