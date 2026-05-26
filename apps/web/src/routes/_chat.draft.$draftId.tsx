import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { ChatRightPanels } from "../components/chat/ChatRightPanels";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMobileEdgeSwipe } from "../hooks/useMobileEdgeSwipe";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  markRightPanelUsed,
  openLastUsedRightPanel,
  useRegisterRightPanel,
} from "../rightPanelGesture";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  closeWorkspaceFilePreview,
  reopenWorkspaceFilePanel,
  type WorkspaceFilePreviewDiffReturnTarget,
  useWorkspaceFilePanelState,
} from "../workspaceFilePreview";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const serverThreadHasSubmittedMessage = Boolean(serverThread && serverThread.messages.length > 0);
  const filePanel = useWorkspaceFilePanelState();
  const filePanelOpen = filePanel.open;
  const shouldUseFileSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );
  const shouldNavigateToCanonicalThread = Boolean(
    canonicalThreadRef && (!draftSession?.promotedTo || serverThreadHasSubmittedMessage),
  );
  const openFilePanel = useCallback(() => {
    reopenWorkspaceFilePanel();
  }, []);
  const returnFromFilePreview = useCallback((_target: WorkspaceFilePreviewDiffReturnTarget) => {
    closeWorkspaceFilePreview();
  }, []);

  useEffect(() => {
    if (!canonicalThreadRef || !shouldNavigateToCanonicalThread) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate, shouldNavigateToCanonicalThread]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  useEffect(() => {
    if (filePanelOpen) {
      markRightPanelUsed("file");
    }
  }, [filePanelOpen]);

  useRegisterRightPanel({
    close: closeWorkspaceFilePreview,
    enabled: draftSession !== null,
    kind: "file",
    open: openFilePanel,
  });

  useMobileEdgeSwipe({
    enabled: shouldUseFileSheet && !filePanelOpen,
    onSwipe: openLastUsedRightPanel,
    side: "right",
    startArea: "screen",
    startSurface: "outside-panels",
  });

  useMobileEdgeSwipe({
    action: "close",
    enabled: shouldUseFileSheet && filePanelOpen,
    onSwipe: closeWorkspaceFilePreview,
    side: "right",
    startArea: "screen",
    startSurface: "panel",
  });

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  const shouldRenderFilePanelContent =
    filePanelOpen || filePanel.target !== null || filePanel.explorerContext !== null;

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
        />
      </SidebarInset>
      <ChatRightPanels
        fileOpen={filePanelOpen}
        renderFileContent={shouldRenderFilePanelContent}
        useSheet={shouldUseFileSheet}
        onReturnFromFileToDiff={returnFromFilePreview}
      />
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
