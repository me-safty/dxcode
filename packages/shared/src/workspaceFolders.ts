import { workspaceRootsMatch } from "./advertisementFiles.ts";

export interface WorkspaceFolderIdentityInput {
  readonly uriScheme?: string | null | undefined;
  readonly uriAuthority?: string | null | undefined;
  readonly fsPath: string;
}

export interface WorkspaceFolderScope {
  readonly key: string;
  readonly cwd: string;
}

export interface WorkspaceScopedEntry {
  readonly workspaceFolders: readonly WorkspaceFolderScope[];
  readonly activeWorkspaceFolderKey?: string | undefined;
}

export function workspaceFolderIdentityKey(input: WorkspaceFolderIdentityInput): string {
  return `${input.uriScheme || "file"}:${input.uriAuthority || ""}:${input.fsPath}`;
}

export function resolveActiveWorkspaceFolder<T extends { readonly key: string }>(
  workspaceFolders: readonly T[],
  activeWorkspaceFolderKey?: string | null | undefined,
): T | undefined {
  if (activeWorkspaceFolderKey) {
    const activeWorkspaceFolder = workspaceFolders.find(
      (folder) => folder.key === activeWorkspaceFolderKey,
    );
    if (activeWorkspaceFolder) {
      return activeWorkspaceFolder;
    }
  }
  return workspaceFolders[0];
}

export function workspaceFoldersIncludeRoot(
  workspaceFolders: readonly Pick<WorkspaceFolderScope, "cwd">[],
  workspaceRoot: string,
): boolean {
  return workspaceFolders.some((folder) => workspaceRootsMatch(folder.cwd, workspaceRoot));
}

export function hasActiveWorkspaceFolder(entry: WorkspaceScopedEntry): boolean {
  return entry.workspaceFolders.some((folder) => folder.key === entry.activeWorkspaceFolderKey);
}
