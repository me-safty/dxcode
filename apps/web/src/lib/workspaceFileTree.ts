import type { ProjectEntry } from "@workbench/contracts";

export interface WorkspaceTreeFileNode {
  kind: "file";
  name: string;
  path: string;
  changed: boolean;
}

export interface WorkspaceTreeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  changed: boolean;
  children: WorkspaceTreeNode[];
}

export type WorkspaceTreeNode = WorkspaceTreeDirectoryNode | WorkspaceTreeFileNode;

interface MutableDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  changed: boolean;
  directories: Map<string, MutableDirectoryNode>;
  files: WorkspaceTreeFileNode[];
}

function basenameOf(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function compareNodeNames(
  left: { name: string; kind: string },
  right: { name: string; kind: string },
) {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function toTreeNodes(directory: MutableDirectoryNode): WorkspaceTreeNode[] {
  const directories = [...directory.directories.values()]
    .map<WorkspaceTreeDirectoryNode>((child) => ({
      kind: "directory",
      name: child.name,
      path: child.path,
      changed: child.changed,
      children: toTreeNodes(child),
    }))
    .sort(compareNodeNames);
  const files = [...directory.files].sort(compareNodeNames);
  return [...directories, ...files];
}

export function buildWorkspaceFileTree(input: {
  entries: ReadonlyArray<ProjectEntry>;
  changedPaths?: ReadonlySet<string>;
}): WorkspaceTreeNode[] {
  const changedPaths = input.changedPaths ?? new Set<string>();
  const root: MutableDirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    changed: false,
    directories: new Map(),
    files: [],
  };

  const sortedEntries = [...input.entries].sort((left, right) =>
    left.path.localeCompare(right.path, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  for (const entry of sortedEntries) {
    const segments = entry.path.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      continue;
    }

    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const path = segments.slice(0, index + 1).join("/");
      let next = current.directories.get(segment);
      if (!next) {
        next = {
          kind: "directory",
          name: segment,
          path,
          changed: false,
          directories: new Map(),
          files: [],
        };
        current.directories.set(segment, next);
      }
      current = next;
    }

    const changed = changedPaths.has(entry.path);
    if (entry.kind === "directory") {
      const name = segments.at(-1)!;
      let next = current.directories.get(name);
      if (!next) {
        next = {
          kind: "directory",
          name,
          path: entry.path,
          changed,
          directories: new Map(),
          files: [],
        };
        current.directories.set(name, next);
      } else if (changed) {
        next.changed = true;
      }
      continue;
    }

    current.files.push({
      kind: "file",
      name: basenameOf(entry.path),
      path: entry.path,
      changed,
    });
  }

  const markChangedDirectories = (directory: MutableDirectoryNode): boolean => {
    let changed = directory.changed;
    for (const child of directory.directories.values()) {
      changed = markChangedDirectories(child) || changed;
    }
    if (directory.files.some((file) => file.changed)) {
      changed = true;
    }
    directory.changed = changed;
    return changed;
  };

  markChangedDirectories(root);
  return toTreeNodes(root);
}
