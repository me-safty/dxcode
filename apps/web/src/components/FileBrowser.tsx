import type { ProjectEntry } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { cn } from "~/lib/utils";
import { FileViewerModal } from "./FileViewerModal";

function isHiddenEntry(name: string): boolean {
  if (name.startsWith(".")) return true;
  if (name === "CLAUDE.md") return true;
  return false;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: TreeNode[];
}

function buildTree(entries: ReadonlyArray<ProjectEntry>): TreeNode[] {
  // First pass: determine which paths are excluded (hidden entries and all their descendants)
  const excluded = new Set<string>();
  for (const entry of entries) {
    const name = entry.path.split("/").pop() ?? entry.path;
    if (isHiddenEntry(name)) excluded.add(entry.path);
    if (entry.parentPath && excluded.has(entry.parentPath)) excluded.add(entry.path);
  }

  const nodeMap = new Map<string, TreeNode>();

  for (const entry of entries) {
    if (excluded.has(entry.path)) continue;

    nodeMap.set(entry.path, {
      name: entry.path.split("/").pop() ?? entry.path,
      path: entry.path,
      kind: entry.kind,
      children: [],
    });
  }

  const roots: TreeNode[] = [];

  for (const entry of entries) {
    const node = nodeMap.get(entry.path);
    if (!node) continue;

    const parentPath = entry.parentPath;
    if (parentPath && nodeMap.has(parentPath)) {
      nodeMap.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(roots);
}

function sendToChat(command: string) {
  const text = command.replace(/\n$/, "");
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent("commandTraySubmit", { detail: { command: text } }),
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  cwd: string;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (relativePath: string) => void;
}

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  depth,
  cwd,
  expandedDirs,
  onToggleDir,
  onFileClick,
}: TreeNodeRowProps) {
  const leftPadding = 8 + depth * 12;

  const handleFileClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const fullPath = `${cwd}/${node.path}`;
        sendToChat(`please read and summarize ${fullPath}`);
      } else {
        onFileClick(node.path);
      }
    },
    [cwd, node.path, onFileClick],
  );

  if (node.kind === "directory") {
    const isExpanded = expandedDirs.has(node.path);
    return (
      <div>
        <button
          type="button"
          className="group flex w-full items-center gap-1 rounded-md py-0.5 pr-2 text-left hover:bg-muted/30"
          style={{ paddingLeft: `${leftPadding}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform group-hover:text-muted-foreground",
              isExpanded && "rotate-90",
            )}
          />
          {isExpanded ? (
            <FolderOpenIcon className="size-3 shrink-0 text-muted-foreground/60" />
          ) : (
            <FolderIcon className="size-3 shrink-0 text-muted-foreground/60" />
          )}
          <span className="truncate font-mono text-[11px] text-muted-foreground group-hover:text-foreground/90">
            {node.name}
          </span>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-1 rounded-md py-0.5 pr-2 text-left hover:bg-muted/30"
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={handleFileClick}
      title="Click to view · ⌘+click to send to chat"
    >
      <span aria-hidden="true" className="size-3 shrink-0" />
      <FileIcon className="size-3 shrink-0 text-muted-foreground/50" />
      <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
        {node.name}
      </span>
    </button>
  );
});

export const FileBrowser = memo(function FileBrowser({ cwd }: { cwd: string | null }) {
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const queryResult = useQuery(
    projectSearchEntriesQueryOptions({ cwd, query: ".", limit: 200 }),
  );

  const entries = queryResult.data?.entries ?? [];

  const treeNodes = useMemo(() => buildTree(entries), [entries]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback((relativePath: string) => {
    setViewingFile(relativePath);
  }, []);

  const handleCloseModal = useCallback((open: boolean) => {
    if (!open) setViewingFile(null);
  }, []);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="group flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-muted/30"
        onClick={() => setSectionExpanded((v) => !v)}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground/70",
            sectionExpanded && "rotate-90",
          )}
        />
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/70">
          Files
        </span>
        {queryResult.data?.truncated && (
          <span className="ml-auto text-[10px] text-muted-foreground/30">200 limit</span>
        )}
      </button>

      {sectionExpanded && (
        <div className="py-0.5">
          {!cwd ? (
            <p className="px-4 py-2 text-[11px] text-muted-foreground/40">No workspace open.</p>
          ) : queryResult.isPending ? (
            <p className="px-4 py-2 text-[11px] text-muted-foreground/40">Loading...</p>
          ) : treeNodes.length === 0 ? (
            <p className="px-4 py-2 text-[11px] text-muted-foreground/40">No files found.</p>
          ) : (
            treeNodes.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                cwd={cwd}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
                onFileClick={handleFileClick}
              />
            ))
          )}
        </div>
      )}

      <FileViewerModal
        cwd={cwd}
        relativePath={viewingFile}
        open={viewingFile !== null}
        onOpenChange={handleCloseModal}
      />
    </div>
  );
});
