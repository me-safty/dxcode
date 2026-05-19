import { scopeThreadRef } from "@t3tools/client-runtime";
import { useCallback } from "react";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { useThreadActions } from "~/hooks/useThreadActions";
import { useBackend } from "~/t3work/backend/t3work-index";
import { useAddToChat } from "~/t3work/hooks/t3work-useAddToChat";
import { useProjectStore } from "~/t3work/hooks/t3work-useProjectStore";
import { buildComprehensiveTicketPayload } from "~/t3work/t3work-addToChatPayloadBuilders";
import { buildJiraWorkItemSummary } from "~/t3work/t3work-jiraContextMetadata";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ViewState } from "~/t3work/t3work-types";

type AppHandlersInput = {
  store: ReturnType<typeof useProjectStore>;
  activeView: ViewState | null;
  onOpenHome: (() => void) | undefined;
  onOpenDashboard: ((projectId: string) => void) | undefined;
  onOpenTicket: ((projectId: string, ticketId: string) => void) | undefined;
  onOpenThread: ((projectId: string, threadId: string) => void) | undefined;
};

export function useAppHandlers({
  store,
  activeView,
  onOpenHome,
  onOpenDashboard,
  onOpenTicket,
  onOpenThread,
}: AppHandlersInput) {
  const environmentId = usePrimaryEnvironmentId();
  const backend = useBackend();
  const { addToChatFromRequest } = useAddToChat();
  const { deleteThread: deleteLiveThread } = useThreadActions();

  const handleSelectProject = useCallback(
    (projectId: string) => {
      store.selectProject(projectId);
      onOpenDashboard?.(projectId);
    },
    [onOpenDashboard, store],
  );

  const handleSelectTicket = useCallback(
    (projectId: string, ticketId: string) => {
      store.selectTicket(projectId, ticketId);
      onOpenTicket?.(projectId, ticketId);
    },
    [onOpenTicket, store],
  );

  const handleSelectThread = useCallback(
    (projectId: string, threadId: string) => {
      store.selectThread(projectId, threadId);
      onOpenThread?.(projectId, threadId);
    },
    [onOpenThread, store],
  );

  const handleCreateThread = useCallback(
    (projectId: string) => {
      const thread = store.createThread(projectId);
      onOpenThread?.(projectId, thread.id);
      return thread.id;
    },
    [onOpenThread, store],
  );

  const handleCreateTicketKickoffThread = useCallback(
    async (input: {
      projectId: string;
      ticketId: string;
      ticketDisplayId: string;
      githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
      kickoffMessage: string;
      kickoffModelSelection: ModelSelection;
      kickoffRuntimeMode: RuntimeMode;
      kickoffInteractionMode: ProviderInteractionMode;
    }) => {
      const thread = store.createThreadForTicket(input);
      onOpenThread?.(input.projectId, thread.id);

      const project = store.allProjects.find((candidate) => candidate.id === input.projectId);
      const ticket = store
        .getTicketsForProject(input.projectId)
        .find((candidate) => candidate.id === input.ticketId);

      if (!backend || !project || !ticket) {
        return;
      }

      const jiraSummary = buildJiraWorkItemSummary(ticket);
      const projectTickets = store.getTicketsForProject(input.projectId);
      await addToChatFromRequest(
        {
          projectId: input.projectId,
          projectTitle: project.title,
          ...(project.workspace?.rootPath
            ? { projectWorkspaceRoot: project.workspace.rootPath }
            : {}),
          targetLabel: `${ticket.ref.displayId} ${ticket.ref.title}`,
          targetType: "work-item",
          kind: "jira-work-item",
          ...(jiraSummary.jiraIssueType ? { jiraIssueType: jiraSummary.jiraIssueType } : {}),
          ...(jiraSummary.jiraIssueTypeIconUrl
            ? { jiraIssueTypeIconUrl: jiraSummary.jiraIssueTypeIconUrl }
            : {}),
          summaryItems: jiraSummary.summaryItems,
          payload: () =>
            buildComprehensiveTicketPayload({
              backend,
              project,
              ticket,
              projectTickets,
              githubActivityItems: input.githubActivityItems,
            }),
        },
        { type: "kickoff", projectId: input.projectId, ticketId: input.ticketId },
      );
    },
    [addToChatFromRequest, backend, onOpenThread, store],
  );

  const handleCreateProjectKickoffThread = useCallback(
    (input: {
      projectId: string;
      kickoffMessage: string;
      kickoffModelSelection: ModelSelection;
      kickoffRuntimeMode: RuntimeMode;
      kickoffInteractionMode: ProviderInteractionMode;
    }) => {
      const thread = store.createThread(input.projectId, {
        title: "Project kickoff",
        kickoffMessage: input.kickoffMessage,
        kickoffPending: true,
        kickoffModelSelection: input.kickoffModelSelection,
        kickoffRuntimeMode: input.kickoffRuntimeMode,
        kickoffInteractionMode: input.kickoffInteractionMode,
      });
      onOpenThread?.(input.projectId, thread.id);
    },
    [onOpenThread, store],
  );

  const handleCreateTicketThreadFromSidebar = useCallback(
    (input: { projectId: string; ticketId: string; ticketDisplayId: string }) => {
      const matching = store
        .getThreadsForProject(input.projectId)
        .filter((thread) => thread.ticketId === input.ticketId);
      const sequence = matching.length + 1;
      const thread = store.createThread(input.projectId, {
        ticketId: input.ticketId,
        title: `${input.ticketDisplayId} thread ${sequence}`,
      });
      onOpenThread?.(input.projectId, thread.id);
      return thread.id;
    },
    [onOpenThread, store],
  );

  const handleThreadKickoffConsumed = useCallback(
    (threadId: string) => {
      store.markThreadKickoffConsumed(threadId);
    },
    [store],
  );

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      const deletedWasActive = activeView?.projectId === projectId;
      store.deleteProject(projectId);
      if (deletedWasActive) onOpenHome?.();
    },
    [activeView, onOpenHome, store],
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      const thread = store.threads.find((candidate) => candidate.id === threadId);
      const deletedWasActive = activeView?.type === "thread" && activeView.threadId === threadId;

      if (environmentId) {
        await deleteLiveThread(scopeThreadRef(environmentId, threadId as never));
      }

      // Keep local t3work shadow state in sync with live thread deletions.
      store.deleteThread(threadId);

      if (deletedWasActive) {
        const projectId = activeView?.projectId ?? thread?.projectId;
        if (projectId) {
          onOpenDashboard?.(projectId);
        }
      }
    },
    [activeView, deleteLiveThread, environmentId, onOpenDashboard, store],
  );

  return {
    handleSelectProject,
    handleSelectTicket,
    handleSelectThread,
    handleCreateThread,
    handleCreateProjectKickoffThread,
    handleCreateTicketKickoffThread,
    handleCreateTicketThreadFromSidebar,
    handleThreadKickoffConsumed,
    handleDeleteProject,
    handleDeleteThread,
  };
}
