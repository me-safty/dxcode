import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { createTicketThread } from "./t3work-projectThreadFactories";
import { buildThreadForProject } from "./t3work-projectStoreUtils";

type SetView = Dispatch<SetStateAction<ViewState | null>>;
type SetThreads = Dispatch<SetStateAction<ProjectThread[]>>;

type CreateThreadOptions = {
  title?: string;
  ticketId?: string;
  kickoffMessage?: string;
  kickoffPending?: boolean;
  kickoffModelSelection?: ModelSelection;
  kickoffRuntimeMode?: RuntimeMode;
  kickoffInteractionMode?: ProviderInteractionMode;
};

export function useProjectThreadActions(input: {
  threads: ProjectThread[];
  setThreads: SetThreads;
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>;
  setExpandedProjectIds: Dispatch<SetStateAction<Set<string>>>;
  setView: SetView;
}) {
  const { threads, setThreads, setSelectedProjectId, setExpandedProjectIds, setView } = input;

  const createThread = useCallback(
    (projectId: string, options?: CreateThreadOptions) => {
      const newThread = buildThreadForProject(projectId, options);
      setThreads((prev) => [...prev, newThread]);
      setSelectedProjectId(projectId);
      setExpandedProjectIds((prev) => new Set(prev).add(projectId));
      setView({ type: "thread", projectId, threadId: newThread.id });
      return newThread;
    },
    [setExpandedProjectIds, setSelectedProjectId, setThreads, setView],
  );

  const createThreadForTicket = useCallback(
    (ticketInput: {
      projectId: string;
      ticketId: string;
      ticketDisplayId: string;
      kickoffMessage: string;
      kickoffModelSelection: ModelSelection;
      kickoffRuntimeMode: RuntimeMode;
      kickoffInteractionMode: ProviderInteractionMode;
    }) =>
      createTicketThread({
        ...ticketInput,
        existingThreads: threads,
        createThread,
      }),
    [createThread, threads],
  );

  const markThreadKickoffConsumed = useCallback(
    (threadId: string) => {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId ? { ...thread, kickoffPending: false } : thread,
        ),
      );
    },
    [setThreads],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
      setView((prev) =>
        prev && prev.type === "thread" && prev.threadId === threadId ? null : prev,
      );
    },
    [setThreads, setView],
  );

  const renameThread = useCallback(
    (threadId: string, newTitle: string) => {
      setThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? { ...thread, title: newTitle } : thread)),
      );
    },
    [setThreads],
  );

  return {
    createThread,
    createThreadForTicket,
    markThreadKickoffConsumed,
    deleteThread,
    renameThread,
  };
}
