import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { useT3WorkAddToChatStore } from "~/t3work/t3work-addToChatStore";

export function enqueueThreadKickoffAttachments(
  threadId: string,
  attachments: ReadonlyArray<T3WorkContextAttachment>,
): void {
  const addToChatStore = useT3WorkAddToChatStore.getState();
  for (const attachment of attachments) {
    addToChatStore.enqueueThreadAttachment(threadId, attachment);
  }
}
