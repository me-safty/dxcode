import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

import { matchesProjectThreadTicket } from "~/t3work/t3work-ticketLookup";
import type { ProjectThread, T3workThreadToolId } from "~/t3work/t3work-types";

export function createTicketThread(input: {
  projectId: string;
  ticketId: string;
  ticketDisplayId: string;
  kickoffMessage: string;
  kickoffModelSelection: ModelSelection;
  kickoffRuntimeMode: RuntimeMode;
  kickoffInteractionMode: ProviderInteractionMode;
  selectedToolIds: ReadonlyArray<T3workThreadToolId>;
  existingThreads: ReadonlyArray<ProjectThread>;
  createThread: (
    projectId: string,
    options?: {
      title?: string;
      ticketId?: string;
      ticketDisplayId?: string;
      kickoffMessage?: string;
      kickoffPending?: boolean;
      kickoffModelSelection?: ModelSelection;
      kickoffRuntimeMode?: RuntimeMode;
      kickoffInteractionMode?: ProviderInteractionMode;
      selectedToolIds?: ReadonlyArray<T3workThreadToolId>;
    },
  ) => ProjectThread;
}) {
  const matching = input.existingThreads.filter(
    (thread) =>
      thread.projectId === input.projectId &&
      matchesProjectThreadTicket(thread, input.ticketId, input.ticketDisplayId),
  );
  const sequence = matching.length + 1;

  return input.createThread(input.projectId, {
    ticketId: input.ticketId,
    ticketDisplayId: input.ticketDisplayId,
    title: `${input.ticketDisplayId} kickoff ${sequence}`,
    kickoffMessage: input.kickoffMessage,
    kickoffPending: true,
    kickoffModelSelection: input.kickoffModelSelection,
    kickoffRuntimeMode: input.kickoffRuntimeMode,
    kickoffInteractionMode: input.kickoffInteractionMode,
    selectedToolIds: input.selectedToolIds,
  });
}
