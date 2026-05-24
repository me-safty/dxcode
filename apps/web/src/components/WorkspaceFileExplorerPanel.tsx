import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderTreeIcon,
  LoaderIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, type ReactNode } from "react";

import { useTheme } from "../hooks/useTheme";
import {
  projectListDirectoryEntriesQueryOptions,
  projectQueryKeys,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const EXPLORER_ROW_HEIGHT_CLASS_NAME = "h-7";
const EXPLORER_DIRECTORY_ENTRY_LIMIT = 500;
const EXPLORER_SEARCH_ENTRY_LIMIT = 120;

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function parentPathsOf(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function entryDepth(entry: ProjectEntry): number {
  return entry.path.split("/").length - 1;
}

function WorkspaceExplorerMessage(props: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs",
        props.tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {props.tone === "error" ? <TriangleAlertIcon className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0">{props.children}</span>
    </div>
  );
}

const WorkspaceExplorerLoadingRows = memo(function WorkspaceExplorerLoadingRows(props: {
  depth: number;
}) {
  return (
    <div className="py-1">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className={cn(
            EXPLORER_ROW_HEIGHT_CLASS_NAME,
            "flex items-center gap-2 px-2 text-muted-foreground/50",
          )}
          style={{ paddingLeft: 10 + props.depth * 14 }}
        >
          <LoaderIcon className="size-3 animate-spin" />
          <div className="h-2.5 w-24 rounded-full bg-muted/60" />
        </div>
      ))}
    </div>
  );
});

const WorkspaceExplorerEntryRow = memo(function WorkspaceExplorerEntryRow(props: {
  entry: ProjectEntry;
  expanded: boolean;
  mode: "tree" | "search";
  onOpenFile: (entry: ProjectEntry) => void;
  onRevealDirectory: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  resolvedTheme: "light" | "dark";
}) {
  const { entry, expanded, mode, onOpenFile, onRevealDirectory, onToggleDirectory, resolvedTheme } =
    props;
  const depth = mode === "tree" ? entryDepth(entry) : 0;
  const isDirectory = entry.kind === "directory";
  const label = basenameOfPath(entry.path);
  const title = mode === "search" ? entry.path : label;

  const onClick = useCallback(() => {
    if (isDirectory) {
      if (mode === "search") {
        onRevealDirectory(entry.path);
        return;
      }
      onToggleDirectory(entry.path);
      return;
    }
    onOpenFile(entry);
  }, [entry, isDirectory, mode, onOpenFile, onRevealDirectory, onToggleDirectory]);

  return (
    <button
      type="button"
      className={cn(
        EXPLORER_ROW_HEIGHT_CLASS_NAME,
        "group flex w-full min-w-0 items-center gap-1.5 px-2 text-left text-[13px] outline-none transition-colors hover:bg-accent/70 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={entry.path}
      onClick={onClick}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/65">
        {isDirectory ? (
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform",
              expanded && mode === "tree" && "rotate-90",
            )}
          />
        ) : null}
      </span>
      <VscodeEntryIcon
        pathValue={entry.path}
        kind={entry.kind}
        theme={resolvedTheme}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-foreground/88">{title}</span>
    </button>
  );
});

function WorkspaceDirectoryEntries(props: {
  cwd: string;
  depth: number;
  directoryPath?: string;
  environmentId: EnvironmentId;
  expandedDirectoryPaths: ReadonlySet<string>;
  onOpenFile: (entry: ProjectEntry) => void;
  onRevealDirectory: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  resolvedTheme: "light" | "dark";
}) {
  const query = useQuery(
    projectListDirectoryEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      directoryPath: props.directoryPath ?? null,
      limit: EXPLORER_DIRECTORY_ENTRY_LIMIT,
    }),
  );
  const entries = query.data?.entries ?? [];
  const isLoadingEmpty = query.isPending || (query.isFetching && entries.length === 0);

  if (isLoadingEmpty) {
    return <WorkspaceExplorerLoadingRows depth={props.depth} />;
  }

  if (query.error) {
    return (
      <WorkspaceExplorerMessage tone="error">
        {query.error instanceof Error ? query.error.message : "Failed to load directory."}
      </WorkspaceExplorerMessage>
    );
  }

  if (entries.length === 0) {
    return props.depth === 0 ? (
      <WorkspaceExplorerMessage>No files found.</WorkspaceExplorerMessage>
    ) : null;
  }

  return (
    <>
      {entries.map((entry) => {
        const expanded = entry.kind === "directory" && props.expandedDirectoryPaths.has(entry.path);
        return (
          <div key={entry.path}>
            <WorkspaceExplorerEntryRow
              entry={entry}
              expanded={expanded}
              mode="tree"
              onOpenFile={props.onOpenFile}
              onRevealDirectory={props.onRevealDirectory}
              onToggleDirectory={props.onToggleDirectory}
              resolvedTheme={props.resolvedTheme}
            />
            {expanded ? (
              <WorkspaceDirectoryEntries
                cwd={props.cwd}
                depth={props.depth + 1}
                directoryPath={entry.path}
                environmentId={props.environmentId}
                expandedDirectoryPaths={props.expandedDirectoryPaths}
                onOpenFile={props.onOpenFile}
                onRevealDirectory={props.onRevealDirectory}
                onToggleDirectory={props.onToggleDirectory}
                resolvedTheme={props.resolvedTheme}
              />
            ) : null}
          </div>
        );
      })}
      {query.data?.truncated ? (
        <WorkspaceExplorerMessage>Directory listing truncated.</WorkspaceExplorerMessage>
      ) : null}
    </>
  );
}

function WorkspaceSearchEntries(props: {
  cwd: string;
  environmentId: EnvironmentId;
  onOpenFile: (entry: ProjectEntry) => void;
  onRevealDirectory: (path: string) => void;
  query: string;
  resolvedTheme: "light" | "dark";
}) {
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: props.query,
      limit: EXPLORER_SEARCH_ENTRY_LIMIT,
      enabled: props.query.length > 0,
    }),
  );
  const entries = searchQuery.data?.entries ?? [];
  const isLoadingEmpty = searchQuery.isPending || (searchQuery.isFetching && entries.length === 0);

  if (isLoadingEmpty) {
    return <WorkspaceExplorerLoadingRows depth={0} />;
  }

  if (searchQuery.error) {
    return (
      <WorkspaceExplorerMessage tone="error">
        {searchQuery.error instanceof Error ? searchQuery.error.message : "Search failed."}
      </WorkspaceExplorerMessage>
    );
  }

  if (entries.length === 0) {
    return <WorkspaceExplorerMessage>No matching files.</WorkspaceExplorerMessage>;
  }

  return (
    <>
      {entries.map((entry) => (
        <WorkspaceExplorerEntryRow
          key={`${entry.kind}:${entry.path}`}
          entry={entry}
          expanded={false}
          mode="search"
          onOpenFile={props.onOpenFile}
          onRevealDirectory={props.onRevealDirectory}
          onToggleDirectory={props.onRevealDirectory}
          resolvedTheme={props.resolvedTheme}
        />
      ))}
      {searchQuery.data?.truncated ? (
        <WorkspaceExplorerMessage>Search results truncated.</WorkspaceExplorerMessage>
      ) : null}
    </>
  );
}

export function WorkspaceFileExplorerPanel(props: {
  expandedDirectoryPaths: ReadonlySet<string>;
  environmentId: EnvironmentId;
  mode: DiffPanelMode;
  onBackToPreview?: (() => void) | undefined;
  onClose: () => void;
  onExpandedDirectoryPathsChange: (paths: Set<string>) => void;
  onOpenFile: (entry: ProjectEntry) => void;
  onSearchQueryChange: (query: string) => void;
  projectName?: string | undefined;
  searchQuery: string;
  workspaceRoot: string;
}) {
  const {
    expandedDirectoryPaths,
    environmentId,
    mode,
    onBackToPreview,
    onClose,
    onExpandedDirectoryPathsChange,
    onOpenFile,
    onSearchQueryChange,
    projectName,
    searchQuery,
    workspaceRoot,
  } = props;
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const trimmedSearchQuery = searchQuery.trim();
  const workspaceLabel = projectName ?? basenameOfPath(workspaceRoot);

  const onToggleDirectory = useCallback(
    (path: string) => {
      const next = new Set(expandedDirectoryPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      onExpandedDirectoryPathsChange(next);
    },
    [expandedDirectoryPaths, onExpandedDirectoryPathsChange],
  );

  const onRevealDirectory = useCallback(
    (path: string) => {
      const next = new Set(expandedDirectoryPaths);
      for (const parentPath of parentPathsOf(path)) {
        next.add(parentPath);
      }
      next.add(path);
      onExpandedDirectoryPathsChange(next);
      onSearchQueryChange("");
    },
    [expandedDirectoryPaths, onExpandedDirectoryPathsChange, onSearchQueryChange],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
  }, [queryClient]);

  const header = useMemo(
    () => (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onBackToPreview ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Back to file viewer"
              title="Back to file viewer"
              onClick={onBackToPreview}
            >
              <ArrowLeftIcon className="size-3.5" />
            </Button>
          ) : null}
          <FolderTreeIcon className="size-4 shrink-0 text-muted-foreground/80" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">Files</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground/70">
              {workspaceLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh file explorer"
            title="Refresh file explorer"
            onClick={refresh}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Close file explorer"
            title="Close file explorer"
            onClick={onClose}
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
      </>
    ),
    [onBackToPreview, onClose, refresh, workspaceLabel],
  );

  return (
    <DiffPanelShell mode={mode} header={header}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground/65" />
            <Input
              aria-label="Search workspace files"
              className="rounded-md [&_input]:pl-8"
              nativeInput
              placeholder="Search files"
              size="sm"
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {trimmedSearchQuery ? (
            <WorkspaceSearchEntries
              cwd={workspaceRoot}
              environmentId={environmentId}
              onOpenFile={onOpenFile}
              onRevealDirectory={onRevealDirectory}
              query={trimmedSearchQuery}
              resolvedTheme={resolvedTheme}
            />
          ) : (
            <WorkspaceDirectoryEntries
              cwd={workspaceRoot}
              depth={0}
              environmentId={environmentId}
              expandedDirectoryPaths={expandedDirectoryPaths}
              onOpenFile={onOpenFile}
              onRevealDirectory={onRevealDirectory}
              onToggleDirectory={onToggleDirectory}
              resolvedTheme={resolvedTheme}
            />
          )}
        </div>
      </div>
    </DiffPanelShell>
  );
}
