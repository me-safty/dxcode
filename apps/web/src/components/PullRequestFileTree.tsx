import type { PullRequestFileEntry } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "~/vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Checkbox } from "./ui/checkbox";

export interface FileLineCounts {
  additions: number;
  deletions: number;
}

interface PullRequestFileTreeProps {
  files: ReadonlyArray<PullRequestFileEntry>;
  lineCounts: Map<string, FileLineCounts>;
  isViewed: (path: string) => boolean;
  onSetViewed: (path: string, viewed: boolean) => void;
  onJumpToFile: (path: string) => void;
  activePath: string | null;
}

interface DirNode {
  kind: "dir";
  name: string;
  fullPath: string;
  children: TreeNode[];
}

interface FileNode {
  kind: "file";
  name: string;
  fullPath: string;
  entry: PullRequestFileEntry;
}

type TreeNode = DirNode | FileNode;

function buildTree(files: ReadonlyArray<PullRequestFileEntry>): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", fullPath: "", children: [] };
  for (const entry of files) {
    const parts = entry.path.split("/");
    let cursor: DirNode = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i] ?? "";
      const childPath = cursor.fullPath ? `${cursor.fullPath}/${segment}` : segment;
      let next = cursor.children.find(
        (node): node is DirNode => node.kind === "dir" && node.name === segment,
      );
      if (!next) {
        next = { kind: "dir", name: segment, fullPath: childPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    const fileName = parts[parts.length - 1] ?? entry.path;
    cursor.children.push({
      kind: "file",
      name: fileName,
      fullPath: entry.path,
      entry,
    });
  }
  // Collapse single-child directory chains for compactness (a/b/c -> a/b/c)
  return collapseChains(root.children);
}

function collapseChains(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== "dir") return node;
    let current: DirNode = node;
    while (current.children.length === 1 && current.children[0]?.kind === "dir") {
      const onlyChild = current.children[0];
      current = {
        kind: "dir",
        name: `${current.name}/${onlyChild.name}`,
        fullPath: onlyChild.fullPath,
        children: onlyChild.children,
      };
    }
    return {
      kind: "dir",
      name: current.name,
      fullPath: current.fullPath,
      children: collapseChains(current.children),
    } satisfies DirNode;
  });
}

function statusDotClass(status: PullRequestFileEntry["status"]): string {
  switch (status) {
    case "A":
      return "bg-emerald-500";
    case "D":
      return "bg-destructive";
    case "R":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/50";
  }
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  isViewed: (path: string) => boolean;
  onSetViewed: (path: string, viewed: boolean) => void;
  onJumpToFile: (path: string) => void;
  activePath: string | null;
  lineCounts: Map<string, FileLineCounts>;
  theme: "light" | "dark";
}

const TreeNodeView = memo(function TreeNodeView({
  node,
  depth,
  isViewed,
  onSetViewed,
  onJumpToFile,
  activePath,
  lineCounts,
  theme,
}: TreeNodeViewProps) {
  const [open, setOpen] = useState(true);
  const padding = { paddingLeft: `${depth * 12 + 6}px` };

  if (node.kind === "dir") {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          style={padding}
          className="group flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open ? (
          <ul>
            {node.children.map((child) => (
              <TreeNodeView
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                isViewed={isViewed}
                onSetViewed={onSetViewed}
                onJumpToFile={onJumpToFile}
                activePath={activePath}
                lineCounts={lineCounts}
                theme={theme}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const viewed = isViewed(node.fullPath);
  const counts = lineCounts.get(node.fullPath);
  const isActive = activePath === node.fullPath;

  return (
    <li>
      <div
        style={padding}
        className={cn(
          "group flex items-center gap-1.5 rounded pr-2 py-1 text-xs hover:bg-muted",
          isActive && "bg-muted",
          viewed && "opacity-60",
        )}
      >
        <button
          type="button"
          onClick={() => onJumpToFile(node.fullPath)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
        >
          <span className="relative shrink-0">
            <VscodeEntryIcon
              pathValue={node.fullPath}
              kind="file"
              theme={theme}
              className="size-3.5"
            />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-background",
                statusDotClass(node.entry.status),
              )}
              aria-hidden="true"
            />
          </span>
          <span
            className={cn("min-w-0 flex-1 truncate font-mono", viewed && "line-through")}
            title={node.fullPath}
          >
            {node.name}
          </span>
          {counts && (counts.additions > 0 || counts.deletions > 0) ? (
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              {counts.additions > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">+{counts.additions}</span>
              ) : null}
              {counts.additions > 0 && counts.deletions > 0 ? " " : null}
              {counts.deletions > 0 ? (
                <span className="text-destructive">-{counts.deletions}</span>
              ) : null}
            </span>
          ) : null}
        </button>
        <label
          className="flex shrink-0 cursor-pointer items-center"
          title={viewed ? "Marked as viewed" : "Mark as viewed"}
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={viewed}
            onCheckedChange={(value) => onSetViewed(node.fullPath, value === true)}
          />
        </label>
      </div>
    </li>
  );
});

export function PullRequestFileTree({
  files,
  lineCounts,
  isViewed,
  onSetViewed,
  onJumpToFile,
  activePath,
}: PullRequestFileTreeProps) {
  const { resolvedTheme } = useTheme();
  const tree = useMemo(() => buildTree(files), [files]);
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  if (files.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">No files changed.</p>;
  }
  return (
    <ul className="py-1">
      {tree.map((node) => (
        <TreeNodeView
          key={node.fullPath}
          node={node}
          depth={0}
          isViewed={isViewed}
          onSetViewed={onSetViewed}
          onJumpToFile={onJumpToFile}
          activePath={activePath}
          lineCounts={lineCounts}
          theme={theme}
        />
      ))}
    </ul>
  );
}

export function fileLineCountsFromPatchFiles(
  files: ReadonlyArray<{
    name?: string;
    prevName?: string;
    hunks: ReadonlyArray<{ additionLines: number; deletionLines: number }>;
  }>,
): Map<string, FileLineCounts> {
  const out = new Map<string, FileLineCounts>();
  for (const file of files) {
    const raw = file.name ?? file.prevName ?? "";
    const path = raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
    let additions = 0;
    let deletions = 0;
    for (const hunk of file.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    out.set(path, { additions, deletions });
  }
  return out;
}

export function basenameOfFile(path: string): string {
  return basenameOfPath(path);
}
