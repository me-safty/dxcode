import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMobileEdgeSwipe } from "../hooks/useMobileEdgeSwipe";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  markRightPanelUsed,
  openLastUsedRightPanel,
  useRegisterRightPanel,
} from "../rightPanelGesture";
import { retainActiveThreadDetailSubscription } from "../environments/runtime/service";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { WorkspaceFilesPanel } from "../components/WorkspaceFilesPanel";
import {
  closeWorkspaceFilePreview,
  reopenWorkspaceFilePanel,
  type WorkspaceFilePreviewDiffReturnTarget,
  useWorkspaceFilePanelState,
} from "../workspaceFilePreview";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const RIGHT_INLINE_PANEL_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const RIGHT_INLINE_PANEL_MIN_WIDTH = 22 * 16;
const RIGHT_INLINE_PANEL_MAX_WIDTH = 256 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;
const MISSING_THREAD_ROUTE_RECOVERY_GRACE_MS = 3_000;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
      <DiffPanel mode={props.mode} />
    </Suspense>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": RIGHT_INLINE_PANEL_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: RIGHT_INLINE_PANEL_MAX_WIDTH,
          minWidth: RIGHT_INLINE_PANEL_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const WorkspaceFilesInlineSidebar = (props: {
  open: boolean;
  renderContent: boolean;
  onReturnToDiff: (target: WorkspaceFilePreviewDiffReturnTarget) => void;
}) => {
  const { onReturnToDiff, open, renderContent } = props;
  const onOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      reopenWorkspaceFilePanel();
      return;
    }
    closeWorkspaceFilePreview();
  }, []);

  return (
    <SidebarProvider
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": RIGHT_INLINE_PANEL_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: RIGHT_INLINE_PANEL_MAX_WIDTH,
          minWidth: RIGHT_INLINE_PANEL_MIN_WIDTH,
          storageKey: "chat_file_preview_sidebar_width",
        }}
      >
        {renderContent ? (
          <WorkspaceFilesPanel mode="sidebar" onReturnToDiff={onReturnToDiff} />
        ) : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const { openMobile: leftSidebarOpenMobile } = useSidebar();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const filePanel = useWorkspaceFilePanelState();
  const filePanelOpen = filePanel.open;
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    markRightPanelUsed("diff");
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);
  const closeDiff = useCallback(() => {
    if (!threadRef || !diffOpen) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [diffOpen, navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markRightPanelUsed("diff");
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, threadRef]);
  const openFilePreview = useCallback(() => {
    reopenWorkspaceFilePanel();
  }, []);
  const returnFromFilePreview = useCallback(
    (returnTarget: WorkspaceFilePreviewDiffReturnTarget) => {
      closeWorkspaceFilePreview();
      if (!threadRef) {
        return;
      }
      markRightPanelUsed("diff");
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return returnTarget.diffSource
            ? {
                ...rest,
                diff: "1",
                diffSource: returnTarget.diffSource,
                ...(returnTarget.diffFilePath ? { diffFilePath: returnTarget.diffFilePath } : {}),
              }
            : returnTarget.diffTurnId
              ? {
                  ...rest,
                  diff: "1",
                  diffTurnId: returnTarget.diffTurnId,
                  ...(returnTarget.diffFilePath ? { diffFilePath: returnTarget.diffFilePath } : {}),
                }
              : { ...rest, diff: "1" };
        },
      });
    },
    [navigate, threadRef],
  );

  useEffect(() => {
    if (diffOpen) {
      markRightPanelUsed("diff");
    }
  }, [diffOpen]);

  useEffect(() => {
    if (filePanelOpen) {
      markRightPanelUsed("file");
    }
  }, [filePanelOpen]);

  useRegisterRightPanel({
    close: closeDiff,
    enabled: threadRef !== null,
    kind: "diff",
    open: openDiff,
  });
  useRegisterRightPanel({
    close: closeWorkspaceFilePreview,
    enabled: threadRef !== null,
    kind: "file",
    open: openFilePreview,
  });

  useMobileEdgeSwipe({
    blockedByOpenPanelSide: "left",
    enabled: shouldUseDiffSheet && !diffOpen && !leftSidebarOpenMobile,
    onSwipe: openLastUsedRightPanel,
    side: "right",
    startArea: "screen",
    startSurface: "outside-panels",
  });

  useMobileEdgeSwipe({
    action: "close",
    enabled: shouldUseDiffSheet && diffOpen,
    onSwipe: closeDiff,
    side: "right",
    startArea: "screen",
    startSurface: "panel",
  });

  useMobileEdgeSwipe({
    action: "close",
    enabled: shouldUseDiffSheet && filePanelOpen,
    onSwipe: closeWorkspaceFilePreview,
    side: "right",
    startArea: "screen",
    startSurface: "panel",
  });

  const isRecoveringMissingThread =
    bootstrapComplete && threadRef !== null && !routeThreadExists && environmentHasAnyThreads;

  useEffect(() => {
    if (!threadRef || draftThreadExists) {
      return;
    }
    return retainActiveThreadDetailSubscription(threadRef.environmentId, threadRef.threadId);
  }, [draftThreadExists, threadRef]);

  useEffect(() => {
    if (!isRecoveringMissingThread) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const latestThreadExists = selectThreadExistsByRef(useStore.getState(), threadRef);
      const latestDraftExists =
        useComposerDraftStore.getState().getDraftThreadByRef(threadRef) !== null;
      if (!latestThreadExists && !latestDraftExists) {
        void navigate({ to: "/", replace: true });
      }
    }, MISSING_THREAD_ROUTE_RECOVERY_GRACE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isRecoveringMissingThread, navigate, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  const shouldRenderThreadRoute =
    threadRef !== null &&
    (routeThreadExists || draftThreadExists || !bootstrapComplete || isRecoveringMissingThread);

  if (!shouldRenderThreadRoute) {
    return null;
  }

  if (isRecoveringMissingThread) {
    return (
      <SidebarInset
        className="flex h-svh min-h-0 items-center justify-center overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh"
        data-testid="thread-route-recovery"
      >
        <DiffPanelLoadingState label="Loading conversation..." />
      </SidebarInset>
    );
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const shouldRenderFilePanelContent =
    filePanelOpen || filePanel.target !== null || filePanel.explorerContext !== null;
  const shouldRenderCodePanelProvider = shouldRenderDiffContent || shouldRenderFilePanelContent;

  if (!shouldUseDiffSheet) {
    const rightPanels = (
      <>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
        <WorkspaceFilesInlineSidebar
          open={filePanelOpen}
          renderContent={shouldRenderFilePanelContent}
          onReturnToDiff={returnFromFilePreview}
        />
      </>
    );

    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markDiffOpened}
            reserveTitleBarControlInset={!diffOpen}
            routeKind="server"
          />
        </SidebarInset>
        {shouldRenderCodePanelProvider ? (
          <DiffWorkerPoolProvider>{rightPanels}</DiffWorkerPoolProvider>
        ) : (
          rightPanels
        )}
      </>
    );
  }

  const rightPanelSheets = (
    <>
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </RightPanelSheet>
      <RightPanelSheet open={filePanelOpen} onClose={closeWorkspaceFilePreview}>
        {shouldRenderFilePanelContent ? (
          <WorkspaceFilesPanel mode="sheet" onReturnToDiff={returnFromFilePreview} />
        ) : null}
      </RightPanelSheet>
    </>
  );

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
        />
      </SidebarInset>
      {shouldRenderCodePanelProvider ? (
        <DiffWorkerPoolProvider>{rightPanelSheets}</DiffWorkerPoolProvider>
      ) : (
        rightPanelSheets
      )}
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
