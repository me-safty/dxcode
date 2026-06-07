import { type EnvironmentId, type FilesystemListDirEntry } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FolderClosedIcon, FolderIcon, Loader2Icon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";

const FILE_TREE_STALE_TIME_MS = 30_000;

function useListDirQuery(input: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  enabled: boolean;
}) {
  const { environmentId, cwd, relativePath, enabled } = input;
  return useQuery({
    queryKey: ["filesystemListDir", environmentId, cwd, relativePath],
    queryFn: async (): Promise<ReadonlyArray<FilesystemListDirEntry>> => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return [];
      }
      const result = await api.filesystem.listDir({ cwd, relativePath });
      return result.entries;
    },
    staleTime: FILE_TREE_STALE_TIME_MS,
    enabled,
  });
}

const TreeRowSpinner = memo(function TreeRowSpinner(props: { depth: number }) {
  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2 text-muted-foreground/70"
      style={{ paddingLeft: `${8 + props.depth * 14}px` }}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
      <span className="font-mono text-[11px]">Loading…</span>
    </div>
  );
});

const TreeRowEmpty = memo(function TreeRowEmpty(props: { depth: number; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2 font-mono text-[11px] text-muted-foreground/60"
      style={{ paddingLeft: `${8 + props.depth * 14}px` }}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      {props.label}
    </div>
  );
});

const DirectoryNode = memo(function DirectoryNode(props: {
  environmentId: EnvironmentId;
  cwd: string;
  entry: FilesystemListDirEntry;
  depth: number;
  theme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}) {
  const { cwd, depth, entry, environmentId, onSelectFile, selectedPath, theme } = props;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);

  return (
    <div>
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={toggle}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
            expanded && "rotate-90",
          )}
        />
        {expanded ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        ) : (
          <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
          {entry.name}
        </span>
      </button>
      {expanded ? (
        <DirectoryChildren
          environmentId={environmentId}
          cwd={cwd}
          relativePath={entry.relativePath}
          depth={depth + 1}
          theme={theme}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ) : null}
    </div>
  );
});

const FileNode = memo(function FileNode(props: {
  entry: FilesystemListDirEntry;
  depth: number;
  theme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}) {
  const { depth, entry, onSelectFile, selectedPath, theme } = props;
  const isSelected = selectedPath === entry.relativePath;
  return (
    <button
      type="button"
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
        isSelected && "bg-accent/60 hover:bg-accent/60",
      )}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => onSelectFile(entry.relativePath)}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <VscodeEntryIcon
        pathValue={entry.relativePath}
        kind="file"
        theme={theme}
        className="size-3.5 text-muted-foreground/70"
      />
      <span
        className={cn(
          "truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90",
          isSelected && "text-foreground",
        )}
      >
        {entry.name}
      </span>
    </button>
  );
});

function DirectoryChildren(props: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  depth: number;
  theme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}) {
  const { cwd, depth, environmentId, onSelectFile, relativePath, selectedPath, theme } = props;
  const query = useListDirQuery({ environmentId, cwd, relativePath, enabled: true });

  if (query.isPending) {
    return <TreeRowSpinner depth={depth} />;
  }

  const entries = query.data ?? [];
  if (entries.length === 0) {
    return <TreeRowEmpty depth={depth} label="Empty" />;
  }

  return (
    <div className="space-y-0.5">
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <DirectoryNode
            key={`dir:${entry.relativePath}`}
            environmentId={environmentId}
            cwd={cwd}
            entry={entry}
            depth={depth}
            theme={theme}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ) : (
          <FileNode
            key={`file:${entry.relativePath}`}
            entry={entry}
            depth={depth}
            theme={theme}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ),
      )}
    </div>
  );
}

export function FileTree(props: {
  environmentId: EnvironmentId;
  cwd: string;
  theme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}) {
  const { cwd, environmentId, onSelectFile, selectedPath, theme } = props;
  return (
    <div className="space-y-0.5 py-1">
      <DirectoryChildren
        environmentId={environmentId}
        cwd={cwd}
        relativePath=""
        depth={0}
        theme={theme}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
