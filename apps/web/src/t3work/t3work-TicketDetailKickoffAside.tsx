import { useEffect, useMemo, useState } from "react";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { TicketKickoffComposer } from "~/t3work/t3work-TicketKickoffComposer";
import { TicketKickoffPanel } from "~/t3work/t3work-TicketKickoffPanel";
import { useT3WorkAddToChatStore, buildKickoffQueueKey } from "~/t3work/t3work-addToChatStore";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectThread } from "~/t3work/t3work-types";

export function TicketDetailKickoffAside({
  displayId,
  issueThreads,
  projectId,
  ticketId,
  githubActivityItems,
  providers,
  isConnected,
  onOpenThread,
  onKickoffThread,
}: {
  displayId: string;
  issueThreads: ProjectThread[];
  projectId: string;
  ticketId: string;
  githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  onOpenThread: (projectId: string, threadId: string) => void;
  onKickoffThread: (input: {
    projectId: string;
    ticketId: string;
    ticketDisplayId: string;
    githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
    kickoffMessage: string;
    kickoffModelSelection: ModelSelection;
    kickoffRuntimeMode: RuntimeMode;
    kickoffInteractionMode: ProviderInteractionMode;
    kickoffContextAttachments: ReadonlyArray<T3WorkContextAttachment>;
  }) => void;
}) {
  const [injectedContextAttachments, setInjectedContextAttachments] = useState<
    readonly T3WorkContextAttachment[]
  >([]);
  const kickoffQueueKey = useMemo(
    () => buildKickoffQueueKey(projectId, ticketId),
    [projectId, ticketId],
  );
  const pendingKickoffCount = useT3WorkAddToChatStore(
    (state) => (state.pendingByKickoffKey[kickoffQueueKey] ?? []).length,
  );

  useEffect(() => {
    if (pendingKickoffCount === 0) {
      return;
    }
    const drained = useT3WorkAddToChatStore.getState().drainKickoff(projectId, ticketId);
    if (drained.length === 0) {
      return;
    }
    setInjectedContextAttachments((current) =>
      mergeContextAttachmentsById({
        current,
        incoming: drained.map((item) => item.attachment),
      }),
    );
  }, [pendingKickoffCount, projectId, ticketId]);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border/70">
      <TicketKickoffPanel
        displayId={displayId}
        issueThreads={issueThreads}
        injectedContextAttachments={injectedContextAttachments}
        onOpenThread={(threadId) => onOpenThread(projectId, threadId)}
        onKickoff={(
          instruction,
          kickoffModelSelection,
          kickoffRuntimeMode,
          kickoffInteractionMode,
          kickoffContextAttachments,
        ) => {
          onKickoffThread({
            projectId,
            ticketId,
            ticketDisplayId: displayId,
            githubActivityItems,
            kickoffMessage: instruction,
            kickoffModelSelection,
            kickoffRuntimeMode,
            kickoffInteractionMode,
            kickoffContextAttachments,
          });
        }}
        renderComposer={({ prefillText, onSubmit }) => (
          <TicketKickoffComposer
            {...(prefillText ? { prefillText } : {})}
            providers={providers}
            isConnected={isConnected}
            onSubmit={onSubmit}
          />
        )}
      />
    </aside>
  );
}
