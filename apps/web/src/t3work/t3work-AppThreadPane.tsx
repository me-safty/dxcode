import type { ProjectShellProject } from "@t3tools/project-context";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";
import { isEmbeddedProjectThread } from "~/t3work/t3work-projectThreadViewState";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";

export function AppThreadPane({
  view,
  threadProject,
  resolvedThread,
  onOpenThread,
  onThreadKickoffConsumed,
  onBackToDashboard,
}: {
  view: Extract<ViewState, { type: "thread" }>;
  threadProject: ProjectShellProject | null;
  resolvedThread: ProjectThread | null;
  onOpenThread: (projectId: string, threadId: string) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onBackToDashboard: (projectId: string) => void;
}) {
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
      onBack={() => {
        if (resolvedThread && isEmbeddedProjectThread(resolvedThread)) {
          onOpenThread(view.projectId, view.threadId);
          return;
        }

        onBackToDashboard(view.projectId);
      }}
    />
  );
}
