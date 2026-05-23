import { useCallback, useEffect, useMemo } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { useShallow } from "zustand/react/shallow";
import ChatView from "~/components/ChatView";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";
import { createThreadSelectorByRef } from "~/storeSelectors";
import { useBackend } from "~/t3work/backend/t3work-index";
import { summarizeT3WorkServerThread } from "~/t3work/chat/t3work-threadDebug";
import { useThreadChatDebug } from "~/t3work/chat/t3work-useThreadChatDebug";
import {
  shouldShowThreadKickoffPlaceholder,
  ThreadKickoffPlaceholder,
} from "~/t3work/chat/t3work-threadKickoffPlaceholder";
import { ThreadPendingChat } from "~/t3work/chat/t3work-threadPendingChat";
import { prepareThreadContextAttachments } from "~/t3work/chat/t3work-prepareThreadContextAttachments";
import { ContextAttachmentStrip } from "~/t3work/components/t3work-ContextAttachmentChip";
import { useThreadBootstrap } from "~/t3work/chat/t3work-useThreadBootstrap";
import { resolveCanonicalProjectIdForWorkspaceRoot } from "~/t3work/hooks/t3work-threadBridge";
import { useAddToChatComposerDropTarget } from "~/t3work/hooks/t3work-useAddToChatComposerDropTarget";
import { useT3WorkAddToChatStore } from "~/t3work/t3work-addToChatStore";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { createT3workTurnToolContext } from "~/t3work/t3work-threadToolContext";
import type { T3workThreadToolId } from "~/t3work/t3work-types";

const EMPTY_ATTACHMENTS: T3WorkContextAttachment[] = [];

export interface ThreadChatViewProps {
  threadId: string;
  projectId: string;
  projectTitle: string;
  projectWorkspaceRoot?: string;
  title: string;
  onBack?: () => void;
  hideHeader?: boolean;
  embeddedMode?: boolean;
  kickoffMessage?: string;
  initialUserMessage?: string;
  initialModelSelection?: ModelSelection;
  initialRuntimeMode?: RuntimeMode;
  initialInteractionMode?: ProviderInteractionMode;
  ticketId?: string;
  selectedToolIds?: ReadonlyArray<T3workThreadToolId>;
  onInitialUserMessageSent?: () => void;
}

export function ThreadChatView({
  threadId,
  projectId,
  projectTitle,
  projectWorkspaceRoot,
  title,
  hideHeader = false,
  embeddedMode = false,
  kickoffMessage,
  initialUserMessage,
  initialModelSelection,
  initialRuntimeMode,
  initialInteractionMode,
  ticketId,
  selectedToolIds,
  onInitialUserMessageSent,
}: ThreadChatViewProps) {
  const backend = useBackend();
  const environmentId = usePrimaryEnvironmentId();
  const liveProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const canonicalProjectId = useMemo(
    () => resolveCanonicalProjectIdForWorkspaceRoot(projectWorkspaceRoot, projectId, liveProjects),
    [liveProjects, projectId, projectWorkspaceRoot],
  );
  const projectExists = useMemo(
    () => liveProjects.some((candidate) => candidate.id === canonicalProjectId),
    [canonicalProjectId, liveProjects],
  );
  const threadRef = useMemo(
    () => (environmentId ? scopeThreadRef(environmentId, threadId as never) : null),
    [environmentId, threadId],
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const hasServerThread = serverThread !== undefined;
  const serverThreadSummary = summarizeT3WorkServerThread(serverThread);
  const serverMessageCount =
    typeof serverThreadSummary?.messageCount === "number" ? serverThreadSummary.messageCount : 0;
  const showKickoffPlaceholder = shouldShowThreadKickoffPlaceholder({
    kickoffMessage,
    serverMessageCount,
  });
  const turnToolContext = useMemo(
    () =>
      createT3workTurnToolContext({
        projectId,
        projectTitle,
        ...(projectWorkspaceRoot ? { workspaceRoot: projectWorkspaceRoot } : {}),
        threadId,
        threadTitle: title,
        ...(ticketId ? { ticketId } : {}),
        ...(selectedToolIds !== undefined ? { selectedToolIds } : {}),
      }),
    [projectId, projectTitle, projectWorkspaceRoot, selectedToolIds, threadId, ticketId, title],
  );

  useThreadBootstrap({
    backend,
    environmentId,
    threadId,
    projectTitle,
    projectWorkspaceRoot,
    canonicalProjectId,
    projectExists,
    title,
    initialUserMessage,
    initialModelSelection,
    initialRuntimeMode,
    initialInteractionMode,
    initialToolContext: turnToolContext,
    onInitialUserMessageSent,
    serverThread,
  });

  useThreadChatDebug({
    backend,
    environmentId,
    projectId,
    threadId,
    projectWorkspaceRoot,
    canonicalProjectId,
    projectExists,
    hasInitialUserMessage: Boolean(initialUserMessage),
    hasServerThread,
    serverThreadSummary,
  });

  const pendingProjectContextCount = useT3WorkAddToChatStore(
    (state) => (state.pendingByProjectId[projectId] ?? []).length,
  );

  useEffect(() => {
    if (pendingProjectContextCount === 0) {
      return;
    }
    const pending = useT3WorkAddToChatStore.getState().drainProject(projectId);
    if (pending.length === 0) {
      return;
    }
    for (const item of pending) {
      useT3WorkAddToChatStore.getState().enqueueThreadAttachment(threadId, item.attachment);
    }
  }, [pendingProjectContextCount, projectId, threadId]);

  const contextAttachmentsOrUndefined = useT3WorkAddToChatStore(
    (state) => state.threadAttachmentsByThreadId[threadId],
  );
  const contextAttachments: T3WorkContextAttachment[] =
    contextAttachmentsOrUndefined ?? EMPTY_ATTACHMENTS;
  const removeContextAttachment = useT3WorkAddToChatStore((state) => state.removeThreadAttachment);
  const clearThreadAttachments = useT3WorkAddToChatStore((state) => state.clearThreadAttachments);
  const composerDropTarget = useAddToChatComposerDropTarget();

  const prepareComposerContextAttachments = useCallback(
    () => prepareThreadContextAttachments({ threadId, backend }),
    [backend, threadId],
  );

  const prepareTurnStart = useCallback(async () => {
    if (!backend) {
      return;
    }

    await backend.syncThreadToolContext({
      threadId,
      toolContext: turnToolContext ?? null,
    });
  }, [backend, threadId, turnToolContext]);

  const contextAttachmentSlot =
    contextAttachments.length > 0 ? (
      <ContextAttachmentStrip
        attachments={contextAttachments}
        onRemove={(id) => removeContextAttachment(threadId, id)}
      />
    ) : null;

  if (!environmentId) {
    return <div className="flex h-full min-h-0 flex-1 bg-background" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {showKickoffPlaceholder && kickoffMessage ? (
        <ThreadKickoffPlaceholder message={kickoffMessage} />
      ) : null}
      {hasServerThread ? (
        <ChatView
          environmentId={environmentId}
          threadId={threadId as never}
          routeKind="server"
          hideHeader={hideHeader || embeddedMode}
          hideBranchToolbar={embeddedMode}
          minimalComposer={embeddedMode}
          beforeDispatchTurnStart={prepareTurnStart}
          composerContextAttachmentSlot={contextAttachmentSlot}
          composerContainerProps={composerDropTarget.composerContainerProps}
          composerContainerOverlay={composerDropTarget.composerContainerOverlay}
          composerContextAttachments={contextAttachments}
          prepareComposerContextAttachments={prepareComposerContextAttachments}
          onComposerContextAttachmentsConsumed={() => clearThreadAttachments(threadId)}
        />
      ) : (
        <ThreadPendingChat />
      )}
    </div>
  );
}
