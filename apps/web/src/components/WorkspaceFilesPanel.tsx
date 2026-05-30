import type { ProjectEntry } from "@t3tools/contracts";
import { FileIcon, PanelRightCloseIcon } from "lucide-react";
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";

import { useComposerHandleContext } from "../composerHandleContext";
import { formatWorkspaceRelativePath } from "../filePathDisplay";
import { closeSourceControlPanel, openSourceControlPanel } from "../sourceControlPanelState";
import type { WorkspaceFilePreviewDiffReturnTarget } from "../workspaceFilePreview";
import {
  closeWorkspaceFilePreview,
  openWorkspaceFileExplorer,
  openWorkspaceFilePreview,
  returnWorkspaceFileExplorerToPreview,
  returnWorkspaceFilePreviewToExplorer,
  useWorkspaceFilePanelState,
  type WorkspaceFileExplorerContext,
} from "../workspaceFilePreview";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";
import { WorkspaceFileExplorerPanel } from "./WorkspaceFileExplorerPanel";
import { WorkspaceFilePreviewPanel } from "./WorkspaceFilePreviewPanel";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

const SourceControlPanel = lazy(() => import("./SourceControlPanel"));

interface ExplorerViewState {
  readonly contextKey: string | null;
  readonly expandedDirectoryPaths: ReadonlySet<string>;
  readonly searchQuery: string;
}

function explorerContextKey(context: WorkspaceFileExplorerContext | null): string | null {
  return context ? `${context.environmentId}:${context.cwd}` : null;
}

function explorerScrollKey(contextKey: string | null, searchQuery: string): string | null {
  return contextKey ? `${contextKey}\n${searchQuery}` : null;
}

function explorerContextFromPreview(
  context: WorkspaceFileExplorerContext | null,
  target: ReturnType<typeof useWorkspaceFilePanelState>["target"],
): WorkspaceFileExplorerContext | null {
  if (context) {
    return context;
  }
  if (!target) {
    return null;
  }
  return {
    environmentId: target.environmentId,
    cwd: target.cwd,
  };
}

function WorkspaceFilesUnavailablePanel(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell
      mode={props.mode}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileIcon className="size-4 shrink-0 text-muted-foreground/80" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">Files</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground/70">
                No workspace selected
              </p>
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Close files panel"
            title="Close files panel"
            onClick={closeWorkspaceFilePreview}
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
        No workspace is available for file browsing.
      </div>
    </DiffPanelShell>
  );
}

function SourceControlLoadingFallback(props: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading source control..." />
    </DiffPanelShell>
  );
}

function LazySourceControlPanel(props: { mode: DiffPanelMode }) {
  const sourceControlMode = props.mode === "sheet" ? "sheet" : "sidebar";
  return (
    <Suspense fallback={<SourceControlLoadingFallback mode={props.mode} />}>
      <SourceControlPanel mode={sourceControlMode} onClose={closeSourceControlPanel} />
    </Suspense>
  );
}

export function WorkspaceFilesPanel(props: {
  mode: DiffPanelMode;
  onReturnToDiff: (target: WorkspaceFilePreviewDiffReturnTarget) => void;
  panelOpen: boolean;
}) {
  const { mode, onReturnToDiff, panelOpen } = props;
  const filePanel = useWorkspaceFilePanelState();
  const composerRef = useComposerHandleContext();
  const explorerContext = explorerContextFromPreview(filePanel.explorerContext, filePanel.target);
  const activeExplorerContextKey = explorerContextKey(explorerContext);
  const explorerScrollTopByKeyRef = useRef(new Map<string, number>());
  const [explorerViewState, setExplorerViewState] = useState<ExplorerViewState>(() => ({
    contextKey: null,
    expandedDirectoryPaths: new Set<string>(),
    searchQuery: "",
  }));
  const emptyExpandedDirectoryPaths = useMemo(() => new Set<string>(), []);
  const searchQuery =
    explorerViewState.contextKey === activeExplorerContextKey ? explorerViewState.searchQuery : "";
  const expandedDirectoryPaths =
    explorerViewState.contextKey === activeExplorerContextKey
      ? explorerViewState.expandedDirectoryPaths
      : emptyExpandedDirectoryPaths;
  const activeExplorerScrollKey = explorerScrollKey(activeExplorerContextKey, searchQuery);
  const explorerScrollTop =
    activeExplorerScrollKey !== null
      ? (explorerScrollTopByKeyRef.current.get(activeExplorerScrollKey) ?? 0)
      : 0;

  const setSearchQuery = useCallback(
    (nextSearchQuery: string) => {
      setExplorerViewState((previous) => ({
        contextKey: activeExplorerContextKey,
        expandedDirectoryPaths:
          previous.contextKey === activeExplorerContextKey
            ? previous.expandedDirectoryPaths
            : new Set<string>(),
        searchQuery: nextSearchQuery,
      }));
    },
    [activeExplorerContextKey],
  );

  const setExpandedDirectoryPaths = useCallback(
    (nextExpandedDirectoryPaths: Set<string>) => {
      setExplorerViewState((previous) => ({
        contextKey: activeExplorerContextKey,
        expandedDirectoryPaths: nextExpandedDirectoryPaths,
        searchQuery: previous.contextKey === activeExplorerContextKey ? previous.searchQuery : "",
      }));
    },
    [activeExplorerContextKey],
  );

  const setExplorerScrollTop = useCallback(
    (nextScrollTop: number) => {
      if (!activeExplorerScrollKey) {
        return;
      }
      explorerScrollTopByKeyRef.current.set(activeExplorerScrollKey, nextScrollTop);
    },
    [activeExplorerScrollKey],
  );

  const showExplorer = useCallback(() => {
    const context = explorerContextFromPreview(filePanel.explorerContext, filePanel.target);
    if (!context) {
      return;
    }
    openWorkspaceFileExplorer(context, {
      returnToPreview: filePanel.target
        ? { target: filePanel.target, returnTarget: filePanel.returnTarget }
        : null,
    });
  }, [filePanel.explorerContext, filePanel.returnTarget, filePanel.target]);

  const openExplorerFile = useCallback(
    (entry: ProjectEntry) => {
      if (!explorerContext || entry.kind !== "file") {
        return;
      }
      openWorkspaceFilePreview(
        {
          environmentId: explorerContext.environmentId,
          cwd: explorerContext.cwd,
          relativePath: entry.path,
          displayPath: formatWorkspaceRelativePath(entry.path, explorerContext.cwd),
        },
        { returnTarget: { kind: "explorer" } },
      );
    },
    [explorerContext],
  );

  const addPathToInput = useCallback(
    (path: string) => {
      const added = composerRef?.current?.addPathMention(path) ?? false;
      if (!added) {
        return;
      }
      toastManager.add({
        type: "success",
        title: "Added to input",
        description: `@${path}`,
      });
    },
    [composerRef],
  );
  const addExplorerFileToInput = useCallback(
    (entry: ProjectEntry) => {
      if (entry.kind !== "file") {
        return;
      }
      addPathToInput(entry.path);
    },
    [addPathToInput],
  );

  const handleReturn = useCallback(
    (returnTarget: NonNullable<typeof filePanel.returnTarget>) => {
      if (returnTarget.kind === "explorer") {
        if (explorerContext) {
          returnWorkspaceFilePreviewToExplorer(explorerContext);
        }
        return;
      }
      if (returnTarget.kind === "source-control") {
        openSourceControlPanel();
        return;
      }
      onReturnToDiff(returnTarget);
    },
    [explorerContext, onReturnToDiff],
  );

  if (filePanel.view === "source-control") {
    return <LazySourceControlPanel mode={mode} />;
  }

  if (filePanel.view === "explorer") {
    if (!explorerContext) {
      return <WorkspaceFilesUnavailablePanel mode={mode} />;
    }
    return (
      <WorkspaceFileExplorerPanel
        expandedDirectoryPaths={expandedDirectoryPaths}
        environmentId={explorerContext.environmentId}
        mode={mode}
        onBackToPreview={
          filePanel.explorerReturnPreview ? returnWorkspaceFileExplorerToPreview : undefined
        }
        onAddFileToInput={addExplorerFileToInput}
        onClose={closeWorkspaceFilePreview}
        onExpandedDirectoryPathsChange={setExpandedDirectoryPaths}
        onOpenFile={openExplorerFile}
        onSearchQueryChange={setSearchQuery}
        onScrollTopChange={setExplorerScrollTop}
        {...(explorerContext.projectName !== undefined
          ? { projectName: explorerContext.projectName }
          : {})}
        scrollRestorationKey={activeExplorerScrollKey ?? "none"}
        scrollTop={explorerScrollTop}
        searchQuery={searchQuery}
        workspaceRoot={explorerContext.cwd}
      />
    );
  }

  const previewOpenedFromExplorer = filePanel.returnTarget?.kind === "explorer";

  return (
    <WorkspaceFilePreviewPanel
      mode={mode}
      panelOpen={panelOpen}
      target={filePanel.target}
      returnTarget={filePanel.returnTarget}
      onAddFileToInput={addPathToInput}
      onReturn={handleReturn}
      onShowExplorer={showExplorer}
      showExplorerButton={explorerContext !== null && !previewOpenedFromExplorer}
    />
  );
}
