import { useEffect, useMemo, useState } from "react";
import type { ServerProvider } from "@t3tools/contracts";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import { readProjectSetupProfileIdFromProject } from "~/t3work/hooks/t3work-createProjectBootstrap";
import { TicketKickoffComposer } from "~/t3work/t3work-TicketKickoffComposer";
import { TicketKickoffPanel } from "~/t3work/t3work-TicketKickoffPanel";
import { useT3WorkAddToChatStore, buildKickoffQueueKey } from "~/t3work/t3work-addToChatStore";
import { mergeContextAttachmentsById } from "~/t3work/t3work-contextAttachmentMerge";
import { EmbeddedThreadAside } from "~/t3work/t3work-EmbeddedThreadAside";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { TicketKickoffThreadInput } from "~/t3work/t3work-kickoffTypes";
import { runT3workViewTransition } from "~/t3work/t3work-runViewTransition";
import { buildT3workSidecarRecipeQuickStarts } from "~/t3work/t3work-sidecarRecipes";
import type { ProjectThread } from "~/t3work/t3work-types";

export function TicketDetailKickoffAside({
  project,
  displayId,
  issueThreads,
  projectId,
  projectTitle,
  projectWorkspaceRoot,
  ticketId,
  activeThread,
  githubActivityItems,
  providers,
  isConnected,
  onOpenThread,
  onOpenFullThread,
  onThreadKickoffConsumed,
  onKickoffThread,
}: {
  project: ProjectShellProject;
  displayId: string;
  issueThreads: ProjectThread[];
  projectId: string;
  projectTitle: string;
  projectWorkspaceRoot?: string;
  ticketId: string;
  activeThread: ProjectThread | null;
  githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  onOpenThread: (projectId: string, threadId: string) => void;
  onOpenFullThread?: (projectId: string, threadId: string) => void;
  onThreadKickoffConsumed: (threadId: string) => void;
  onKickoffThread: (input: TicketKickoffThreadInput) => void;
}) {
  const [injectedContextAttachments, setInjectedContextAttachments] = useState<
    readonly T3WorkContextAttachment[]
  >([]);
  const kickoffQueueKey = useMemo(
    () => buildKickoffQueueKey(projectId, ticketId),
    [projectId, ticketId],
  );
  const quickStartRecipes = useMemo(
    () =>
      buildT3workSidecarRecipeQuickStarts({
        surface: "workitem.detail.sidepanel",
        project,
        profileId: readProjectSetupProfileIdFromProject(project),
        selectedWorkLabel: displayId,
        resourceKind: "ticket",
        availableIntegrations: githubActivityItems.length > 0 ? ["github"] : [],
        availableContextKeys: ["project.summary", "ticket.summary"],
      }),
    [displayId, githubActivityItems.length, project],
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

  if (activeThread) {
    return (
      <EmbeddedThreadAside
        thread={activeThread}
        projectId={projectId}
        projectTitle={projectTitle}
        {...(projectWorkspaceRoot ? { projectWorkspaceRoot } : {})}
        ticketId={ticketId}
        {...(onOpenFullThread
          ? { onOpenFullThread: () => onOpenFullThread(projectId, activeThread.id) }
          : {})}
        onThreadKickoffConsumed={onThreadKickoffConsumed}
      />
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/70 bg-background [view-transition-name:t3work-right-sidebar-panel]">
      <TicketKickoffPanel
        displayId={displayId}
        issueThreads={issueThreads}
        quickStartRecipes={quickStartRecipes}
        injectedContextAttachments={injectedContextAttachments}
        onOpenThread={(threadId) =>
          runT3workViewTransition(() => onOpenThread(projectId, threadId))
        }
        onKickoff={(
          instruction,
          kickoffModelSelection,
          kickoffRuntimeMode,
          kickoffInteractionMode,
          selectedToolIds,
          kickoffContextAttachments,
        ) => {
          runT3workViewTransition(() => {
            onKickoffThread({
              projectId,
              ticketId,
              ticketDisplayId: displayId,
              githubActivityItems,
              kickoffMessage: instruction,
              kickoffModelSelection,
              kickoffRuntimeMode,
              kickoffInteractionMode,
              selectedToolIds,
              kickoffContextAttachments,
            });
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
