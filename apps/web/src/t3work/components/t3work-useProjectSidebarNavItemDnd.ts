import { useCallback } from "react";

import type { AgentContextCapabilities } from "~/t3work/t3work-agentContext";
import { getSidebarItemFromAgentContextCapabilities } from "~/t3work/t3work-agentContext";
import {
  useT3WorkAgentContextDrag,
  useT3WorkAgentContextDropTarget,
} from "~/t3work/t3work-agentContextDrag";

import { useProjectSidebarNavItemPreferences } from "./t3work-useProjectSidebarNavItemPreferences";

export function useProjectSidebarNavItemDnd(input: {
  projectId: string;
  itemId: string;
  label: string;
  capabilities: AgentContextCapabilities | null;
  scopeItemIds: ReadonlyArray<string>;
}) {
  const { projectId, itemId, label, capabilities, scopeItemIds } = input;
  const { reorderItemsInScope } = useProjectSidebarNavItemPreferences(projectId);
  const dragProps = useT3WorkAgentContextDrag({ capabilities, label });

  const canDrop = useCallback(
    (record: { capabilities: AgentContextCapabilities }) => {
      const sourceItem = getSidebarItemFromAgentContextCapabilities(record.capabilities);
      return Boolean(
        sourceItem &&
        sourceItem.projectId === projectId &&
        sourceItem.id !== itemId &&
        scopeItemIds.includes(sourceItem.id),
      );
    },
    [itemId, projectId, scopeItemIds],
  );

  const onDropRecord = useCallback(
    (record: { capabilities: AgentContextCapabilities }) => {
      const sourceItem = getSidebarItemFromAgentContextCapabilities(record.capabilities);
      if (!sourceItem) {
        return;
      }

      reorderItemsInScope(scopeItemIds, sourceItem.id, itemId);
    },
    [itemId, reorderItemsInScope, scopeItemIds],
  );

  const { isActive: isDropActive, dropProps } = useT3WorkAgentContextDropTarget({
    canDrop,
    onDropRecord,
    dropEffect: "move",
  });

  return {
    dragProps,
    dropProps,
    isDropActive,
  };
}
