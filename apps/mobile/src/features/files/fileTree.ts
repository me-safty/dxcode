import type { ProjectEntry } from "@t3tools/contracts";

export interface FileTreeNode {
  readonly path: string;
  readonly name: string;
  readonly kind: ProjectEntry["kind"];
  readonly children: ReadonlyArray<FileTreeNode>;
}

export interface VisibleFileTreeNode {
  readonly node: FileTreeNode;
  readonly depth: number;
}

interface MutableFileTreeNode {
  path: string;
  name: string;
  kind: ProjectEntry["kind"];
  children: Map<string, MutableFileTreeNode>;
}

function createMutableNode(
  path: string,
  name: string,
  kind: ProjectEntry["kind"],
): MutableFileTreeNode {
  return {
    path,
    name,
    kind,
    children: new Map(),
  };
}

function freezeNode(node: MutableFileTreeNode): FileTreeNode {
  return {
    path: node.path,
    name: node.name,
    kind: node.kind,
    children: [...node.children.values()].sort(compareNodes).map(freezeNode),
  };
}

function compareNodes(
  left: Pick<FileTreeNode, "kind" | "name">,
  right: Pick<FileTreeNode, "kind" | "name">,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

export function buildFileTree(entries: ReadonlyArray<ProjectEntry>): ReadonlyArray<FileTreeNode> {
  const root = createMutableNode("", "", "directory");

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) {
        continue;
      }

      const path = parts.slice(0, index + 1).join("/");
      const isLeaf = index === parts.length - 1;
      const kind = isLeaf ? entry.kind : "directory";
      let child = current.children.get(part);
      if (!child) {
        child = createMutableNode(path, part, kind);
        current.children.set(part, child);
      } else if (isLeaf) {
        child.kind = entry.kind;
      }
      current = child;
    }
  }

  return [...root.children.values()].sort(compareNodes).map(freezeNode);
}

export function countFileNodes(nodes: ReadonlyArray<FileTreeNode>): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === "file") {
      count += 1;
    } else {
      count += countFileNodes(node.children);
    }
  }
  return count;
}

export function defaultExpandedTreePaths(nodes: ReadonlyArray<FileTreeNode>): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "directory") {
      expanded.add(node.path);
    }
  }
  return expanded;
}

function nodeMatchesSearch(node: FileTreeNode, query: string): boolean {
  return node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);
}

function flattenNode(
  output: VisibleFileTreeNode[],
  node: FileTreeNode,
  depth: number,
  expanded: ReadonlySet<string>,
  normalizedSearch: string,
): boolean {
  const matches = normalizedSearch.length > 0 && nodeMatchesSearch(node, normalizedSearch);
  let descendantMatches = false;
  const childOutput: VisibleFileTreeNode[] = [];

  if (node.kind === "directory" && (expanded.has(node.path) || normalizedSearch.length > 0)) {
    for (const child of node.children) {
      if (flattenNode(childOutput, child, depth + 1, expanded, normalizedSearch)) {
        descendantMatches = true;
      }
    }
  }

  const visible = normalizedSearch.length === 0 || matches || descendantMatches;
  if (!visible) {
    return false;
  }

  output.push({ node, depth });
  output.push(...childOutput);
  return matches || descendantMatches;
}

export function flattenFileTree(input: {
  readonly nodes: ReadonlyArray<FileTreeNode>;
  readonly expanded: ReadonlySet<string>;
  readonly searchQuery?: string;
}): ReadonlyArray<VisibleFileTreeNode> {
  const output: VisibleFileTreeNode[] = [];
  const normalizedSearch = input.searchQuery?.trim().toLowerCase() ?? "";
  for (const node of input.nodes) {
    flattenNode(output, node, 0, input.expanded, normalizedSearch);
  }
  return output;
}

export function firstFilePath(nodes: ReadonlyArray<FileTreeNode>): string | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      return node.path;
    }
    const child = firstFilePath(node.children);
    if (child !== null) {
      return child;
    }
  }
  return null;
}
