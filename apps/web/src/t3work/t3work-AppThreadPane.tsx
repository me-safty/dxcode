import { useCallback, useEffect } from "react";
import { useCanGoBack } from "@tanstack/react-router";
import type { ProjectShellProject } from "@t3tools/project-context";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";
import { navigateBackWithFallback } from "~/t3work/t3work-historyBack";

export function AppThreadPane({
  view,
  threadProject,
  resolvedThread,
  onOpenTicket,
  onThreadKickoffConsumed,
  onRememberFullThread,
  onBackToDashboard,
}: {
  view: Extract<ViewState, { type: "thread" }>;
  threadProject: ProjectShellProject | null;
  resolvedThread: ProjectThread | null;
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onRememberFullThread: (threadId: string) => void;
  onBackToDashboard: (projectId: string) => void;
}) {
  const canGoBack = useCanGoBack();

  useEffect(() => {
    if (!resolvedThread) {
      return;
    }

    onRememberFullThread(resolvedThread.id);
  }, [onRememberFullThread, resolvedThread]);

  const handleBack = useCallback(() => {
    navigateBackWithFallback({
      canGoBack,
      onFallback: () => {
        if (resolvedThread?.ticketId) {
          onOpenTicket(view.projectId, resolvedThread.ticketId);
          return;
        }

        onBackToDashboard(view.projectId);
      },
    });
  }, [canGoBack, onBackToDashboard, onOpenTicket, resolvedThread?.ticketId, view.projectId]);

  return (
    <ThreadChatView
      threadId={view.threadId}
      projectId={view.projectId}
      projectTitle={threadProject?.title ?? view.projectId}
      {...(threadProject?.workspace?.rootPath
        ? { projectWorkspaceRoot: threadProject.workspace.rootPath }
        : {})}
      title={resolvedThread?.title ?? "New thread"}
      {...(resolvedThread?.kickoffMessage ? { kickoffMessage: resolvedThread.kickoffMessage } : {})}
      {...(resolvedThread?.kickoffPending && resolvedThread.kickoffMessage
        ? { initialUserMessage: resolvedThread.kickoffMessage }
        : {})}
      {...(resolvedThread?.kickoffModelSelection
        ? { initialModelSelection: resolvedThread.kickoffModelSelection }
        : {})}
      {...(resolvedThread?.kickoffRuntimeMode
        ? { initialRuntimeMode: resolvedThread.kickoffRuntimeMode }
        : {})}
      {...(resolvedThread?.kickoffInteractionMode
        ? { initialInteractionMode: resolvedThread.kickoffInteractionMode }
        : {})}
      {...(resolvedThread?.selectedToolIds !== undefined
        ? { selectedToolIds: resolvedThread.selectedToolIds }
        : {})}
      {...(resolvedThread?.ticketId ? { ticketId: resolvedThread.ticketId } : {})}
      onInitialUserMessageSent={() => {
        if (resolvedThread) {
          onThreadKickoffConsumed(resolvedThread.id);
        }
      }}
      onBack={handleBack}
    />
  );
}
