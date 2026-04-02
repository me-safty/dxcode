import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ChatView from "../components/ChatView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { WorkspaceRightSidebar } from "../components/WorkspaceRightSidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { type DiffRouteSearch, parseDiffRouteSearch } from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useSettings } from "../hooks/useSettings";
import { useStore } from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspaceTerminalPortalTargetsContext } from "../workspaceTerminalPortal";
import { cn } from "~/lib/utils";
import { resolveWorkspacePanels, WORKSPACE_PANEL_STORAGE_KEYS } from "../workspacePanels";

const DiffPanel = lazy(() => import("../components/DiffPanel"));

const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const TerminalPanelSheet = (props: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: { open: boolean; renderDiffContent: boolean }) => {
  const { open, renderDiffContent } = props;

  return (
    <WorkspaceRightSidebar
      defaultWidth={DIFF_INLINE_DEFAULT_WIDTH}
      minWidth={DIFF_INLINE_SIDEBAR_MIN_WIDTH}
      open={open}
      storageKey={WORKSPACE_PANEL_STORAGE_KEYS.diffRight}
    >
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        </div>
      </div>
    </WorkspaceRightSidebar>
  );
};

const SharedRightWorkspaceRail = (props: {
  activePanel: "diff" | "terminal" | null;
  fallbackPanel: "diff" | "terminal";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderDiffContent: boolean;
  setTerminalPortalTarget: (element: HTMLElement | null) => void;
  storageKey: string;
}) => {
  const {
    activePanel,
    fallbackPanel,
    onOpenChange,
    open,
    renderDiffContent,
    setTerminalPortalTarget,
    storageKey,
  } = props;
  const renderedPanel = activePanel ?? fallbackPanel;

  return (
    <WorkspaceRightSidebar
      defaultWidth={DIFF_INLINE_DEFAULT_WIDTH}
      minWidth={DIFF_INLINE_SIDEBAR_MIN_WIDTH}
      onOpenChange={onOpenChange}
      open={open}
      storageKey={storageKey}
    >
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-hidden",
              renderedPanel === "diff" ? "flex" : "hidden",
            )}
          >
            {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
          </div>
          <div
            ref={setTerminalPortalTarget}
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-hidden",
              renderedPanel === "terminal" ? "flex" : "hidden",
            )}
            data-workspace-terminal-slot="right"
          />
        </div>
      </div>
    </WorkspaceRightSidebar>
  );
};

function ChatThreadRouteView() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const navigate = useNavigate();
  const settings = useSettings();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const setTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const [workspaceBottomTerminalPortalTarget, setWorkspaceBottomTerminalPortalTarget] =
    useState<HTMLElement | null>(null);
  const [workspaceRightTerminalPortalTarget, setWorkspaceRightTerminalPortalTarget] =
    useState<HTMLElement | null>(null);
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const lastRightRailPanelRef = useRef<"diff" | "terminal">(
    terminalState.terminalOpen ? "terminal" : "diff",
  );
  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: { diff: undefined },
    });
  }, [navigate, threadId]);

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
    }
  }, [diffOpen]);

  useEffect(() => {
    if (!bootstrapComplete) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, navigate, routeThreadExists]);

  const workspacePanels = resolveWorkspacePanels({
    terminalPosition: settings.terminalPosition,
    terminalBottomScope: settings.terminalBottomScope,
    shouldUseDiffSheet,
    diffOpen,
    terminalOpen: terminalState.terminalOpen,
  });
  const activeRightRailPanel = workspacePanels.rightRailPanel;

  useEffect(() => {
    if (activeRightRailPanel === null) {
      return;
    }
    lastRightRailPanelRef.current = activeRightRailPanel;
  }, [activeRightRailPanel]);

  const rightRailStorageKey =
    settings.terminalRightRailWidthMode === "linked"
      ? WORKSPACE_PANEL_STORAGE_KEYS.sharedRight
      : (activeRightRailPanel ?? lastRightRailPanelRef.current) === "terminal"
        ? WORKSPACE_PANEL_STORAGE_KEYS.terminalRight
        : WORKSPACE_PANEL_STORAGE_KEYS.diffRight;
  const chatViewLayoutState = useMemo(
    () => ({
      diffToggleActive: workspacePanels.diffToggleActive,
      terminalDockTarget: workspacePanels.terminalDockTarget,
      terminalToggleActive: workspacePanels.terminalToggleActive,
    }),
    [
      workspacePanels.diffToggleActive,
      workspacePanels.terminalDockTarget,
      workspacePanels.terminalToggleActive,
    ],
  );
  const portalTargets = useMemo(
    () => ({
      bottom: workspaceBottomTerminalPortalTarget,
      right: workspaceRightTerminalPortalTarget,
    }),
    [workspaceBottomTerminalPortalTarget, workspaceRightTerminalPortalTarget],
  );

  if (!bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const shouldMountInlineDiffRail = workspacePanels.supportsInlineDiffRail && hasOpenedDiff;
  const chatWorkspace = (
    <SidebarInset className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      <ChatView key={threadId} layoutState={chatViewLayoutState} threadId={threadId} />
    </SidebarInset>
  );

  const rightWorkspacePanel =
    settings.terminalPosition === "right" && !workspacePanels.showTerminalSheet ? (
      <SharedRightWorkspaceRail
        activePanel={activeRightRailPanel}
        fallbackPanel={lastRightRailPanelRef.current}
        open={activeRightRailPanel !== null}
        onOpenChange={(open) => {
          if (open) {
            if (lastRightRailPanelRef.current === "terminal") {
              setTerminalOpen(threadId, true);
              return;
            }
            void navigate({
              to: "/$threadId",
              params: { threadId },
              search: (previous) => ({ ...previous, diff: "1" }),
            });
            return;
          }

          if (activeRightRailPanel === "terminal") {
            setTerminalOpen(threadId, false);
            return;
          }

          void closeDiff();
        }}
        renderDiffContent={shouldRenderDiffContent}
        setTerminalPortalTarget={setWorkspaceRightTerminalPortalTarget}
        storageKey={rightRailStorageKey}
      />
    ) : shouldMountInlineDiffRail ? (
      <DiffPanelInlineSidebar
        open={workspacePanels.showInlineDiffRail}
        renderDiffContent={shouldRenderDiffContent}
      />
    ) : null;

  const workspaceRow = (
    <div className="flex min-h-0 min-w-0 flex-1">
      {chatWorkspace}
      {rightWorkspacePanel}
    </div>
  );

  return (
    <WorkspaceTerminalPortalTargetsContext.Provider value={portalTargets}>
      <div
        className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-y-none bg-background text-foreground"
        data-workspace-shell="true"
      >
        {workspaceRow}
        <div
          ref={setWorkspaceBottomTerminalPortalTarget}
          className="min-w-0 shrink-0"
          data-workspace-bottom-terminal-slot="true"
        />
      </div>
      {shouldUseDiffSheet ? (
        <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
          {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
        </DiffPanelSheet>
      ) : null}
      {workspacePanels.showTerminalSheet ? (
        <TerminalPanelSheet
          open={workspacePanels.showTerminalSheet}
          onOpenChange={(open) => {
            if (!open) {
              setTerminalOpen(threadId, false);
            }
          }}
        >
          <div
            ref={setWorkspaceRightTerminalPortalTarget}
            className="flex h-full min-h-0 min-w-0 overflow-hidden"
            data-workspace-terminal-slot="right-sheet"
          />
        </TerminalPanelSheet>
      ) : null}
    </WorkspaceTerminalPortalTargetsContext.Provider>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
