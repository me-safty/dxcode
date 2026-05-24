import type { ProjectEntry } from "@t3tools/contracts";
import { FileIcon, PanelRightCloseIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { formatWorkspaceRelativePath } from "../filePathDisplay";
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
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { WorkspaceFileExplorerPanel } from "./WorkspaceFileExplorerPanel";
import { WorkspaceFilePreviewPanel } from "./WorkspaceFilePreviewPanel";
import { Button } from "./ui/button";

interface ExplorerViewState {
  readonly contextKey: string | null;
  readonly expandedDirectoryPaths: ReadonlySet<string>;
  readonly searchQuery: string;
}

function explorerContextKey(context: WorkspaceFileExplorerContext | null): string | null {
  return context ? `${context.environmentId}:${context.cwd}` : null;
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
            variant="ghost"
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

export function WorkspaceFilesPanel(props: {
  mode: DiffPanelMode;
  onReturnToDiff: (target: WorkspaceFilePreviewDiffReturnTarget) => void;
}) {
  const { mode, onReturnToDiff } = props;
  const filePanel = useWorkspaceFilePanelState();
  const explorerContext = explorerContextFromPreview(filePanel.explorerContext, filePanel.target);
  const activeExplorerContextKey = explorerContextKey(explorerContext);
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

  const handleReturn = useCallback(
    (returnTarget: NonNullable<typeof filePanel.returnTarget>) => {
      if (returnTarget.kind === "explorer") {
        if (explorerContext) {
          returnWorkspaceFilePreviewToExplorer(explorerContext);
        }
        return;
      }
      onReturnToDiff(returnTarget);
    },
    [explorerContext, onReturnToDiff],
  );

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
        onClose={closeWorkspaceFilePreview}
        onExpandedDirectoryPathsChange={setExpandedDirectoryPaths}
        onOpenFile={openExplorerFile}
        onSearchQueryChange={setSearchQuery}
        {...(explorerContext.projectName !== undefined
          ? { projectName: explorerContext.projectName }
          : {})}
        searchQuery={searchQuery}
        workspaceRoot={explorerContext.cwd}
      />
    );
  }

  return (
    <WorkspaceFilePreviewPanel
      mode={mode}
      target={filePanel.target}
      returnTarget={filePanel.returnTarget}
      onReturn={handleReturn}
      onShowExplorer={showExplorer}
      showExplorerButton={explorerContext !== null}
    />
  );
}
