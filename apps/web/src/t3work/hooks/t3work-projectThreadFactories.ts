import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

import type { ProjectThread } from "~/t3work/t3work-types";

export function createTicketThread(input: {
  projectId: string;
  ticketId: string;
  ticketDisplayId: string;
  kickoffMessage: string;
  kickoffModelSelection: ModelSelection;
  kickoffRuntimeMode: RuntimeMode;
  kickoffInteractionMode: ProviderInteractionMode;
  existingThreads: ReadonlyArray<ProjectThread>;
  createThread: (
    projectId: string,
    options?: {
      title?: string;
      ticketId?: string;
      kickoffMessage?: string;
      kickoffPending?: boolean;
      kickoffModelSelection?: ModelSelection;
      kickoffRuntimeMode?: RuntimeMode;
      kickoffInteractionMode?: ProviderInteractionMode;
    },
  ) => ProjectThread;
}) {
  const matching = input.existingThreads.filter(
    (thread) => thread.projectId === input.projectId && thread.ticketId === input.ticketId,
  );
  const sequence = matching.length + 1;

  return input.createThread(input.projectId, {
    ticketId: input.ticketId,
    title: `${input.ticketDisplayId} kickoff ${sequence}`,
    kickoffMessage: input.kickoffMessage,
    kickoffPending: true,
    kickoffModelSelection: input.kickoffModelSelection,
    kickoffRuntimeMode: input.kickoffRuntimeMode,
    kickoffInteractionMode: input.kickoffInteractionMode,
  });
}
