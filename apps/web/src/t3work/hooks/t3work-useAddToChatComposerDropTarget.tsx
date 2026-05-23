import { useMemo } from "react";

import type { AddToChatTarget } from "~/t3work/hooks/t3work-useAddToChat";
import { useAddToChat } from "~/t3work/hooks/t3work-useAddToChat";
import {
  T3WorkAgentContextDropOverlay,
  useT3WorkAgentContextDropTarget,
} from "~/t3work/t3work-agentContextDrag";

export function useAddToChatComposerDropTarget(target?: AddToChatTarget) {
  const { addToChatFromRequest } = useAddToChat();
  const { isActive, dropProps } = useT3WorkAgentContextDropTarget({
    canDrop: (record) =>
      record.capabilities.actions.some((action) => action.kind === "add-to-chat"),
    onDropRecord: async (record) => {
      const action = record.capabilities.actions.find(
        (candidate) => candidate.kind === "add-to-chat",
      );
      if (action?.kind !== "add-to-chat") {
        return;
      }

      await addToChatFromRequest(action.request, target);
    },
    dropEffect: "copy",
  });

  return useMemo(
    () => ({
      composerContainerProps: dropProps,
      composerContainerOverlay: (
        <T3WorkAgentContextDropOverlay
          active={isActive}
          label="Drop to add this item to the chat"
          className="rounded-[20px]"
        />
      ),
    }),
    [dropProps, isActive],
  );
}
