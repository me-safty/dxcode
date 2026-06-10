import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";

import type {
  EnvironmentId,
  ProjectId,
  ProjectListTreeResult,
  ProjectTreeEntry,
} from "@t3tools/contracts";

import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useIdeStore } from "../../ideStore";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { FileContextMenu, type FileMenuTarget } from "./FileContextMenu";

type ContextMenuHandler = (entry: ProjectTreeEntry, event: React.MouseEvent) => void;

interface FileTreeProps {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cwd: string;
}

function useDirectoryQuery(args: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  enabled: boolean;
}) {
  const { environmentId, cwd, relativePath, enabled } = args;
  return useQuery<ProjectListTreeResult>({
    queryKey: ["ide", "tree", environmentId, cwd, relativePath],
    enabled,
    staleTime: 15_000,
    queryFn: () => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        throw new Error("Project connection is not available.");
      }
      return api.projects.listTree({
        cwd,
        ...(relativePath.length > 0 ? { relativePath } : {}),
      });
    },
  });
}

export function FileTree(props: FileTreeProps) {
  const { environmentId, projectId, cwd } = props;
  const { resolvedTheme } = useTheme();
  const openFile = useIdeStore((state) => state.openFile);
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  const handleContextMenu = useCallback<ContextMenuHandler>((entry, event) => {
    event.preventDefault();
    setMenu({ entry, x: event.clientX, y: event.clientY });
  }, []);
  const root = useDirectoryQuery({ environmentId, cwd, relativePath: "", enabled: true });

  if (root.isLoading) {
    return (
      <TreeMessage icon={<Loader2Icon className="size-3.5 animate-spin" />}>Loading…</TreeMessage>
    );
  }
  if (root.isError) {
    return (
      <TreeMessage tone="error">
        {root.error instanceof Error ? root.error.message : "Failed to load files."}
      </TreeMessage>
    );
  }

  const entries = root.data?.entries ?? [];
  if (entries.length === 0) {
    return <TreeMessage>Empty project</TreeMessage>;
  }

  return (
    <>
      <ul className="select-none py-1 text-sm" role="tree">
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            environmentId={environmentId}
            cwd={cwd}
            theme={resolvedTheme}
            onContextMenu={handleContextMenu}
          />
        ))}
      </ul>
      {menu ? (
        <FileContextMenu
          target={menu}
          environmentId={environmentId}
          projectId={projectId}
          cwd={cwd}
          onOpen={(entry) => openFile(entry.path, entry.name)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

interface TreeNodeProps {
  entry: ProjectTreeEntry;
  depth: number;
  environmentId: EnvironmentId;
  cwd: string;
  theme: "light" | "dark";
  onContextMenu: ContextMenuHandler;
}

function TreeNode(props: TreeNodeProps) {
  const { entry, depth, environmentId, cwd, theme, onContextMenu } = props;
  const isDirectory = entry.kind === "directory";

  const expanded = useIdeStore((state) => Boolean(state.expandedDirs[entry.path]));
  const toggleDir = useIdeStore((state) => state.toggleDir);
  const openFile = useIdeStore((state) => state.openFile);
  const activeTabPath = useIdeStore((state) => state.activeTabPath);

  const children = useDirectoryQuery({
    environmentId,
    cwd,
    relativePath: entry.path,
    enabled: isDirectory && expanded,
  });

  const isActive = !isDirectory && activeTabPath === entry.path;
  const indent = 8 + depth * 12;

  return (
    <li role="treeitem" aria-expanded={isDirectory ? expanded : undefined}>
      <button
        type="button"
        onClick={() => (isDirectory ? toggleDir(entry.path) : openFile(entry.path, entry.name))}
        onContextMenu={(event) => onContextMenu(entry, event)}
        style={{ paddingLeft: indent }}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-muted-foreground/90 hover:bg-accent hover:text-foreground",
          isActive && "bg-accent text-foreground",
        )}
        title={entry.path}
      >
        {isDirectory ? (
          expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 opacity-70" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <VscodeEntryIcon
          pathValue={entry.path}
          kind={entry.kind}
          theme={theme}
          className="size-4 shrink-0"
        />
        <span className="truncate">{entry.name}</span>
      </button>

      {isDirectory && expanded ? (
        <ul role="group">
          {children.isLoading ? (
            <TreeMessage
              indent={indent + 18}
              icon={<Loader2Icon className="size-3 animate-spin" />}
            >
              Loading…
            </TreeMessage>
          ) : children.isError ? (
            <TreeMessage indent={indent + 18} tone="error">
              {children.error instanceof Error ? children.error.message : "Failed to load."}
            </TreeMessage>
          ) : (
            (children.data?.entries ?? []).map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                environmentId={environmentId}
                cwd={cwd}
                theme={theme}
                onContextMenu={onContextMenu}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

function TreeMessage(props: {
  children: React.ReactNode;
  indent?: number;
  icon?: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{ paddingLeft: props.indent ?? 12 }}
      className={cn(
        "flex items-center gap-1.5 py-1 pr-2 text-xs",
        props.tone === "error" ? "text-destructive" : "text-muted-foreground/70",
      )}
    >
      {props.icon}
      <span className="truncate">{props.children}</span>
    </div>
  );
}
