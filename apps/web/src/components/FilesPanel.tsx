import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { type DiffPanelMode, DiffPanelShell } from "./DiffPanelShell";
import { FileTree } from "./files/FileTree";
import { FileViewer } from "./files/FileViewer";
import { parseFilesRouteSearch, stripFilesSearchParams } from "../filesRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { cn } from "~/lib/utils";

function FileTreePlaceholder(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center">
      <p className="font-mono text-[11px] text-muted-foreground/70">{props.label}</p>
    </div>
  );
}

const FILES_TREE_WIDTH_STORAGE_KEY = "chat_files_tree_width";
const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 560;
const DEFAULT_TREE_WIDTH = 224;

function clampTreeWidth(value: number): number {
  return Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, value));
}

function readStoredTreeWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_TREE_WIDTH;
  }
  const raw = window.localStorage.getItem(FILES_TREE_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isNaN(parsed) ? DEFAULT_TREE_WIDTH : clampTreeWidth(parsed);
}

export default function FilesPanel(props: { mode: DiffPanelMode }) {
  const { mode } = props;
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const filesSearch = useSearch({
    strict: false,
    select: (search) => parseFilesRouteSearch(search),
  });
  const selectedPath = filesSearch.filesPath ?? null;

  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const environmentId = activeThread?.environmentId ?? null;
  const cwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  const onSelectFile = useCallback(
    (relativePath: string) => {
      if (!activeThread) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(activeThread.environmentId, activeThread.id),
        ),
        replace: true,
        search: (previous) => {
          const rest = stripFilesSearchParams(previous);
          return { ...rest, files: "1", filesPath: relativePath };
        },
      });
    },
    [activeThread, navigate],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [treeWidth, setTreeWidth] = useState(readStoredTreeWidth);
  const treeWidthRef = useRef(treeWidth);

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      // Tree sits on the right edge, so its width grows as the pointer moves left.
      const next = clampTreeWidth(rect.right - moveEvent.clientX);
      treeWidthRef.current = next;
      setTreeWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(FILES_TREE_WIDTH_STORAGE_KEY, String(treeWidthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const isSheet = mode === "sheet";

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 text-sm font-medium text-foreground">Files</span>
      {selectedPath ? (
        <span className="truncate font-mono text-[11px] text-muted-foreground/80">
          {selectedPath}
        </span>
      ) : null}
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={header}>
      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          {environmentId && cwd ? (
            <FileViewer
              environmentId={environmentId}
              cwd={cwd}
              relativePath={selectedPath}
              theme={resolvedTheme}
            />
          ) : null}
        </div>
        {isSheet ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file tree"
            onPointerDown={onResizeStart}
            className="relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50"
          >
            {/* Widen the hit area without shifting the visible 1px line. */}
            <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>
        )}
        <div
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-y-auto border-l border-border bg-card/30",
            isSheet && "w-40",
          )}
          style={isSheet ? undefined : { width: treeWidth }}
        >
          {environmentId && cwd ? (
            <FileTree
              environmentId={environmentId}
              cwd={cwd}
              theme={resolvedTheme}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ) : (
            <FileTreePlaceholder label="No project files available." />
          )}
        </div>
      </div>
    </DiffPanelShell>
  );
}
