import { parsePatchFiles } from "@pierre/diffs";
import { type FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId, ProjectEntry, ThreadId, TurnId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Code2Icon,
  EyeIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  FolderOpenIcon,
  FolderOutputIcon,
  ListTodoIcon,
  Maximize2Icon,
  Minimize2Icon,
  FilesIcon,
  FolderKanbanIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  Rows3Icon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActivePlanState, LatestProposedPlanState, WorkLogEntry } from "../session-logic";
import type { TurnDiffSummary } from "../types";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { openInPreferredEditor } from "../editorPreferences";
import { resolvePathLinkTarget } from "../terminal-links";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { formatTimestamp } from "../timestampFormat";
import { readEnvironmentApi } from "~/environmentApi";
import { toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import {
  buildWorkspaceBreadcrumbSegments,
  formatWorkspaceRelativePath,
  resolveWorkspaceSelectionPath,
} from "../filePathDisplay";
import {
  describeWorkspaceArtifact,
  type WorkspaceArtifact,
  selectRecentArtifactOutputs,
} from "../workspaceArtifacts";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import ChatMarkdown from "./ChatMarkdown";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";
import {
  projectListEntriesQueryOptions,
  projectReadFileQueryOptions,
} from "../lib/projectReactQuery";
import { buildWorkspaceFileTree, type WorkspaceTreeNode } from "../lib/workspaceFileTree";

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function textPreviewForFileDiff(fileDiff: FileDiffMetadata | undefined): string | null {
  if (!fileDiff) {
    return null;
  }
  const sourceLines = fileDiff.type === "deleted" ? fileDiff.deletionLines : fileDiff.additionLines;
  const normalizedLines = sourceLines
    .map((line) => line.replace(/\t/g, "  ").replace(/\s+$/g, ""))
    .join("\n")
    .trim();
  if (normalizedLines.length === 0) {
    return null;
  }
  return normalizedLines.split("\n").slice(0, 20).join("\n");
}

function compactWorkHeading(workEntry: WorkLogEntry): string {
  if (workEntry.requestKind === "command") return "Approval needed";
  if (workEntry.requestKind === "file-read") return "Workspace access";
  if (workEntry.requestKind === "file-change") return "Edit approval";
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return "Updated files";
  }
  if (workEntry.itemType === "web_search") return "Collected sources";
  if (workEntry.itemType === "image_view") return "Reviewed image";
  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return "Worked in workspace";
  }
  return workEntry.toolTitle?.trim() || workEntry.label;
}

function compactWorkPreview(
  workEntry: WorkLogEntry,
  workspaceRoot: string | undefined,
): string | null {
  const firstChangedFile = workEntry.changedFiles?.[0];
  if (firstChangedFile) {
    const displayPath = formatWorkspaceRelativePath(firstChangedFile, workspaceRoot);
    return workEntry.changedFiles!.length > 1
      ? `${displayPath} +${workEntry.changedFiles!.length - 1}`
      : displayPath;
  }
  if (workEntry.detail?.trim()) {
    return workEntry.detail.trim();
  }
  if (workEntry.command?.trim()) {
    return workEntry.command.trim();
  }
  return null;
}

function statusToneClass(status: WorkspaceArtifact["status"]) {
  switch (status) {
    case "Created":
      return "text-emerald-400";
    case "Removed":
      return "text-rose-400";
    case "Moved":
    case "Moved and updated":
      return "text-amber-400";
    default:
      return "text-blue-400";
  }
}

function ancestorPathsOf(path: string | null): string[] {
  if (!path) return [];
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function firstFilePath(entries: ReadonlyArray<ProjectEntry> | undefined): string | null {
  return entries?.find((entry) => entry.kind === "file")?.path ?? null;
}

function basenameOfPath(path: string | undefined): string {
  if (!path) return "Workspace";
  const trimmed = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

function WorkspaceBreadcrumb(props: {
  path: string;
  workspaceRoot: string | undefined;
  onOpen: () => void;
}) {
  const segments = useMemo(
    () => buildWorkspaceBreadcrumbSegments(props.path, props.workspaceRoot),
    [props.path, props.workspaceRoot],
  );
  const filename = segments.at(-1) ?? "No file selected";
  const leadingSegments = segments.slice(0, -1);

  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-sm text-foreground/90 transition-colors hover:text-blue-400"
      title="Open file in its native app"
    >
      {leadingSegments.length > 0 ? (
        <>
          <span
            dir="rtl"
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground/72"
          >
            {leadingSegments.join(" / ")}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
        </>
      ) : null}
      <span className="shrink-0 truncate font-medium text-foreground/92">{filename}</span>
    </button>
  );
}

interface WorkspacePanelProps {
  open: boolean;
  mode?: "sheet" | "sidebar";
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  workspaceRoot: string | undefined;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  artifacts: ReadonlyArray<WorkspaceArtifact>;
  workEntries: ReadonlyArray<WorkLogEntry>;
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<string, number>>;
  focusedPath?: string | null;
  onClose: () => void;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
  onAddTextToChat?: (input: { path: string; text: string }) => void;
}

function WorkspaceTree(props: {
  nodes: ReadonlyArray<WorkspaceTreeNode>;
  expandedDirectories: ReadonlySet<string>;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {props.nodes.map((node) =>
        node.kind === "directory" ? (
          <WorkspaceTreeDirectory
            key={node.path}
            node={node}
            depth={0}
            expandedDirectories={props.expandedDirectories}
            selectedPath={props.selectedPath}
            resolvedTheme={props.resolvedTheme}
            onToggleDirectory={props.onToggleDirectory}
            onSelectFile={props.onSelectFile}
          />
        ) : (
          <WorkspaceTreeFile
            key={node.path}
            node={node}
            depth={0}
            selectedPath={props.selectedPath}
            resolvedTheme={props.resolvedTheme}
            onSelectFile={props.onSelectFile}
          />
        ),
      )}
    </div>
  );
}

function WorkspaceTreeDirectory(props: {
  node: Extract<WorkspaceTreeNode, { kind: "directory" }>;
  depth: number;
  expandedDirectories: ReadonlySet<string>;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const isExpanded = props.expandedDirectories.has(props.node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => props.onToggleDirectory(props.node.path)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/84 transition-colors hover:bg-background/80"
        style={{ paddingLeft: `${props.depth * 14 + 8}px` }}
      >
        {isExpanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
        )}
        <VscodeEntryIcon
          pathValue={props.node.path}
          kind="directory"
          theme={props.resolvedTheme}
          className="size-4 shrink-0 text-muted-foreground/75"
        />
        <span className="min-w-0 flex-1 truncate">{props.node.name}</span>
        {props.node.changed ? (
          <span className="size-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden="true" />
        ) : null}
      </button>
      {isExpanded ? (
        <div>
          {props.node.children.map((child) =>
            child.kind === "directory" ? (
              <WorkspaceTreeDirectory
                key={child.path}
                node={child}
                depth={props.depth + 1}
                expandedDirectories={props.expandedDirectories}
                selectedPath={props.selectedPath}
                resolvedTheme={props.resolvedTheme}
                onToggleDirectory={props.onToggleDirectory}
                onSelectFile={props.onSelectFile}
              />
            ) : (
              <WorkspaceTreeFile
                key={child.path}
                node={child}
                depth={props.depth + 1}
                selectedPath={props.selectedPath}
                resolvedTheme={props.resolvedTheme}
                onSelectFile={props.onSelectFile}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceTreeFile(props: {
  node: Extract<WorkspaceTreeNode, { kind: "file" }>;
  depth: number;
  selectedPath: string | null;
  resolvedTheme: "light" | "dark";
  onSelectFile: (path: string) => void;
}) {
  const isSelected = props.selectedPath === props.node.path;
  return (
    <button
      type="button"
      onClick={() => props.onSelectFile(props.node.path)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        isSelected ? "bg-blue-500/12 text-foreground" : "text-foreground/82 hover:bg-background/80",
      )}
      style={{ paddingLeft: `${props.depth * 14 + 28}px` }}
    >
      <VscodeEntryIcon
        pathValue={props.node.path}
        kind="file"
        theme={props.resolvedTheme}
        className="size-4 shrink-0 text-muted-foreground/72"
      />
      <span className="min-w-0 flex-1 truncate">{props.node.name}</span>
      {props.node.changed ? (
        <span className="size-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden="true" />
      ) : null}
    </button>
  );
}

const WorkspacePanel = memo(function WorkspacePanel({
  open,
  mode = "sidebar",
  environmentId,
  threadId,
  workspaceRoot,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  artifacts,
  workEntries,
  activePlan,
  activeProposedPlan,
  turnDiffSummaries,
  inferredCheckpointTurnCountByTurnId,
  focusedPath,
  onClose,
  onOpenTurnDiff,
  onAddTextToChat,
}: WorkspacePanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<"document" | "task">(
    activePlan || activeProposedPlan ? "task" : "document",
  );
  const [documentViewMode, setDocumentViewMode] = useState<"preview" | "code">("preview");
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [isSavingPlanToWorkspace, setIsSavingPlanToWorkspace] = useState(false);
  const [selectedDocumentText, setSelectedDocumentText] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const documentSelectionContainerRef = useRef<HTMLDivElement | null>(null);

  const recentArtifacts = useMemo(() => selectRecentArtifactOutputs(artifacts), [artifacts]);
  const changedPaths = useMemo(
    () => new Set(artifacts.map((artifact) => artifact.path)),
    [artifacts],
  );

  const workspaceEntriesQuery = useQuery(
    projectListEntriesQueryOptions({
      environmentId,
      cwd: workspaceRoot ?? null,
      enabled: open && !!workspaceRoot,
      limit: 8_000,
    }),
  );

  useEffect(() => {
    if (selectedPath) {
      const stillExists =
        workspaceEntriesQuery.data?.entries.some((entry) => entry.path === selectedPath) ??
        artifacts.some((artifact) => artifact.path === selectedPath);
      if (stillExists) {
        return;
      }
    }
    setSelectedPath(
      recentArtifacts[0]?.path ??
        artifacts[0]?.path ??
        firstFilePath(workspaceEntriesQuery.data?.entries) ??
        null,
    );
  }, [artifacts, recentArtifacts, selectedPath, workspaceEntriesQuery.data?.entries]);

  useEffect(() => {
    if (!focusedPath) {
      return;
    }
    setSelectedPath(focusedPath);
    setViewerMode("document");
    setDocumentViewMode("preview");
  }, [focusedPath]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    setExpandedDirectories((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorPathsOf(selectedPath)) {
        next.add(ancestor);
      }
      if (next.size === current.size && [...next].every((path) => current.has(path))) {
        return current;
      }
      return next;
    });
  }, [selectedPath]);

  useEffect(() => {
    setSelectedDocumentText("");
  }, [documentViewMode, selectedPath, viewerMode]);

  const workspaceTree = useMemo(
    () =>
      buildWorkspaceFileTree({
        entries: workspaceEntriesQuery.data?.entries ?? [],
        changedPaths,
      }),
    [changedPaths, workspaceEntriesQuery.data?.entries],
  );

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.path === selectedPath) ?? null,
    [artifacts, selectedPath],
  );
  const selectedDescriptor = useMemo(
    () => (selectedPath ? describeWorkspaceArtifact(selectedPath) : null),
    [selectedPath],
  );

  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = turnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return null;
    }
    return Math.max(...turnCounts);
  }, [inferredCheckpointTurnCountByTurnId, turnDiffSummaries]);

  const checkpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId,
      threadId,
      fromTurnCount: 0,
      toTurnCount: conversationCheckpointTurnCount,
      cacheScope: "workspace-panel",
      enabled: open && artifacts.length > 0 && conversationCheckpointTurnCount !== null,
    }),
  );

  const fileDiffByPath = useMemo(() => {
    const patch = checkpointDiffQuery.data?.diff?.trim();
    if (!patch) {
      return new Map<string, FileDiffMetadata>();
    }
    try {
      const parsed = parsePatchFiles(patch, buildPatchCacheKey(patch, "workspace-panel"));
      const next = new Map<string, FileDiffMetadata>();
      for (const parsedPatch of parsed) {
        for (const file of parsedPatch.files) {
          next.set(resolveFileDiffPath(file), file);
        }
      }
      return next;
    } catch {
      return new Map<string, FileDiffMetadata>();
    }
  }, [checkpointDiffQuery.data?.diff]);

  const selectedFileDiff = selectedPath ? fileDiffByPath.get(selectedPath) : undefined;
  const selectedPatchPreview = useMemo(
    () => textPreviewForFileDiff(selectedFileDiff),
    [selectedFileDiff],
  );

  const textFileQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId,
      cwd: workspaceRoot ?? null,
      relativePath: selectedPath,
      enabled: open && !!workspaceRoot && selectedDescriptor?.previewKind === "text",
      maxBytes: 24_000,
    }),
  );

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;

  const resolveArtifactTargetPath = useCallback(
    (path: string) => (workspaceRoot ? resolvePathLinkTarget(path, workspaceRoot) : path),
    [workspaceRoot],
  );

  const openArtifact = useCallback(
    (path: string) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }
      const targetPath = resolveArtifactTargetPath(path);
      void openInPreferredEditor(api, targetPath).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [resolveArtifactTargetPath],
  );

  const openArtifactInNativeApp = useCallback(
    (path: string) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }
      const targetPath = resolveArtifactTargetPath(path);
      void api.shell.openInEditor(targetPath, "file-manager").catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [resolveArtifactTargetPath],
  );

  const revealWorkspaceRoot = useCallback(() => {
    const api = readLocalApi();
    if (!api || !workspaceRoot) {
      return;
    }
    void api.shell.openInEditor(workspaceRoot, "file-manager").catch((error) => {
      toastManager.add({
        type: "error",
        title: "Could not open folder",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [workspaceRoot]);

  const savePlanToWorkspace = useCallback(() => {
    if (!workspaceRoot || !planMarkdown) {
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }
    setIsSavingPlanToWorkspace(true);
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then((result) => {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      })
      .finally(() => {
        setIsSavingPlanToWorkspace(false);
      });
  }, [environmentId, planMarkdown, workspaceRoot]);

  const syncSelectedDocumentText = useCallback(() => {
    const container = documentSelectionContainerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectedDocumentText("");
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectedDocumentText("");
      return;
    }
    const nextText = selection.toString().trim();
    setSelectedDocumentText(nextText.slice(0, 12_000));
  }, []);

  const addSelectedTextToChat = useCallback(() => {
    if (!selectedPath || !selectedDocumentText.trim() || !onAddTextToChat) {
      return;
    }
    onAddTextToChat({
      path: selectedPath,
      text: selectedDocumentText.trim(),
    });
    setSelectedDocumentText("");
  }, [onAddTextToChat, selectedDocumentText, selectedPath]);

  const selectedDocumentContent =
    textFileQuery.data?.contents || (textFileQuery.isError ? selectedPatchPreview : null);
  const selectedDocumentTruncated = textFileQuery.data?.truncated ?? false;

  const firstDiffCapableArtifact = useMemo(
    () => artifacts.find((artifact) => !!artifact.turnId) ?? null,
    [artifacts],
  );

  const supportsCodeView = selectedDescriptor?.previewKind === "text";
  const activeDocumentViewMode = supportsCodeView ? documentViewMode : "preview";

  const refreshWorkspacePanel = useCallback(() => {
    void workspaceEntriesQuery.refetch();
    void checkpointDiffQuery.refetch();
    if (selectedDescriptor?.previewKind === "text") {
      void textFileQuery.refetch();
    }
  }, [checkpointDiffQuery, selectedDescriptor?.previewKind, textFileQuery, workspaceEntriesQuery]);

  const selectWorkspaceFile = useCallback((path: string) => {
    setSelectedPath(path);
    setViewerMode("document");
    setDocumentViewMode("preview");
  }, []);
  const openWorkspaceFileFromLink = useCallback(
    (path: string) => {
      const selectionPath = resolveWorkspaceSelectionPath(path, workspaceRoot);
      if (selectionPath === null) {
        return false;
      }
      selectWorkspaceFile(selectionPath);
      return true;
    },
    [selectWorkspaceFile, workspaceRoot],
  );

  const workspaceRootLabel = useMemo(() => basenameOfPath(workspaceRoot), [workspaceRoot]);

  return (
    <div
      data-panel-mode={mode}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-card/55",
        isExpanded
          ? "absolute inset-0 z-20 border-l-0 bg-background/95 shadow-2xl backdrop-blur-sm"
          : "h-full w-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-blue-400 uppercase"
          >
            Workspace
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground/68">
            {workspaceEntriesQuery.data?.entries.length
              ? `${workspaceEntriesQuery.data.entries.length} files and folders`
              : artifacts.length > 0
                ? `${artifacts.length} changed files`
                : "Browse the project and review outputs"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setFileTreeOpen((current) => !current)}
            aria-label={fileTreeOpen ? "Hide files list" : "Show files list"}
            title={fileTreeOpen ? "Hide files list" : "Show files list"}
            className={cn(
              "gap-1.5 rounded-full border px-2.5",
              fileTreeOpen
                ? "border-blue-200/80 bg-blue-500/10 text-blue-600 hover:bg-blue-500/14 dark:border-blue-400/30 dark:text-blue-300"
                : "border-border/70 bg-background/70 text-foreground/74 hover:bg-accent/60",
            )}
          >
            <FilesIcon className="size-3.5" />
            Files
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label="Close workspace panel"
            title="Close workspace panel"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            fileTreeOpen && "border-r border-border/60",
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={viewerMode === "document" ? "secondary" : "ghost"}
                onClick={() => setViewerMode("document")}
                className="h-8"
              >
                <FolderOutputIcon className="size-3.5" />
                File
              </Button>
              {(activePlan || activeProposedPlan) && (
                <Button
                  size="sm"
                  variant={viewerMode === "task" ? "secondary" : "ghost"}
                  onClick={() => setViewerMode("task")}
                  className="h-8"
                >
                  <ListTodoIcon className="size-3.5" />
                  Task
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {viewerMode === "document" ? (
                <>
                  <Button
                    size="xs"
                    variant={activeDocumentViewMode === "preview" ? "secondary" : "ghost"}
                    onClick={() => setDocumentViewMode("preview")}
                    className="gap-1.5"
                  >
                    <EyeIcon className="size-3.5" />
                    Preview
                  </Button>
                  <Button
                    size="xs"
                    variant={activeDocumentViewMode === "code" ? "secondary" : "ghost"}
                    onClick={() => setDocumentViewMode("code")}
                    disabled={!supportsCodeView}
                    className="gap-1.5"
                  >
                    <Code2Icon className="size-3.5" />
                    Code
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={refreshWorkspacePanel}
                    aria-label="Refresh workspace view"
                    title="Refresh workspace view"
                  >
                    <RefreshCwIcon className="size-3.5" />
                  </Button>
                </>
              ) : null}
              {!fileTreeOpen ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setFileTreeOpen(true)}
                  aria-label="Show files list"
                  title="Show files list"
                  className="gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 text-foreground/74 hover:bg-accent/60"
                >
                  <FilesIcon className="size-3.5" />
                  Files
                </Button>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setIsExpanded((current) => !current)}
                aria-label={isExpanded ? "Shrink workspace panel" : "Expand workspace panel"}
                title={isExpanded ? "Shrink workspace panel" : "Expand workspace panel"}
              >
                {isExpanded ? (
                  <Minimize2Icon className="size-3.5" />
                ) : (
                  <Maximize2Icon className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          {viewerMode === "task" ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-4">
                <div className="rounded-2xl border border-border/55 bg-background/55 p-4">
                  <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground/55 uppercase">
                    Current task
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground/78">
                    Plan mode stays visible here while work is running.
                  </p>
                </div>

                {activePlan?.explanation ? (
                  <div className="rounded-2xl border border-border/55 bg-background/60 p-4 text-sm leading-6 text-muted-foreground/82">
                    {activePlan.explanation}
                  </div>
                ) : null}

                {activePlan?.steps.length ? (
                  <div className="space-y-2 rounded-2xl border border-border/55 bg-background/60 p-4">
                    {activePlan.steps.map((step) => (
                      <div key={`${step.status}:${step.step}`} className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            step.status === "completed" && "bg-emerald-400",
                            step.status === "inProgress" && "bg-blue-400",
                            step.status === "pending" && "bg-muted-foreground/35",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-6 text-foreground/86">{step.step}</p>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/55">
                            {step.status === "inProgress"
                              ? "In progress"
                              : step.status === "completed"
                                ? "Completed"
                                : "Pending"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {displayedPlanMarkdown ? (
                  <div className="rounded-2xl border border-border/55 bg-background/60">
                    <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground/88">
                          {planTitle ?? "Task outline"}
                        </p>
                        <p className="text-[11px] text-muted-foreground/65">
                          {formatTimestamp(activeProposedPlan!.updatedAt, timestampFormat)}
                        </p>
                      </div>
                      <Menu>
                        <MenuTrigger
                          render={<Button size="icon-xs" variant="ghost" aria-label="Task actions" />}
                        >
                          <Rows3Icon className="size-3.5" />
                        </MenuTrigger>
                        <MenuPopup align="end">
                          <MenuItem onClick={() => copyToClipboard(planMarkdown!)}>
                            {isCopied ? "Copied!" : "Copy plan"}
                          </MenuItem>
                          <MenuItem
                            onClick={() =>
                              downloadPlanAsTextFile(
                                buildProposedPlanMarkdownFilename(planMarkdown!),
                                normalizePlanMarkdownForExport(planMarkdown!),
                              )
                            }
                          >
                            Download markdown
                          </MenuItem>
                          <MenuItem
                            onClick={savePlanToWorkspace}
                            disabled={!workspaceRoot || isSavingPlanToWorkspace}
                          >
                            Save to workspace
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </div>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                      onClick={() => setShowPlanDetails((value) => !value)}
                    >
                      <span className="text-sm text-muted-foreground/78">
                        Review the current task outline
                      </span>
                      {showPlanDetails ? (
                        <ChevronDownIcon className="size-4 text-muted-foreground/65" />
                      ) : (
                        <ChevronRightIcon className="size-4 text-muted-foreground/65" />
                      )}
                    </button>
                    {showPlanDetails ? (
                      <div className="border-t border-border/55 px-4 py-4">
                        <ChatMarkdown
                          cwd={markdownCwd}
                          text={displayedPlanMarkdown}
                          onOpenWorkspaceFile={openWorkspaceFileFromLink}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {workEntries.length > 0 ? (
                  <div className="space-y-2">
                    {workEntries
                      .slice(-6)
                      .reverse()
                      .map((entry) => {
                        const preview = compactWorkPreview(entry, workspaceRoot);
                        return (
                          <div
                            key={entry.id}
                            className="rounded-2xl border border-border/55 bg-background/55 px-4 py-3"
                          >
                            <div className="flex items-center gap-2">
                              <Rows3Icon className="size-3.5 shrink-0 text-muted-foreground/55" />
                              <p className="min-w-0 flex-1 truncate text-sm text-foreground/86">
                                {compactWorkHeading(entry)}
                              </p>
                              <span className="text-[11px] text-muted-foreground/60">
                                {formatTimestamp(entry.createdAt, timestampFormat)}
                              </span>
                            </div>
                            {preview ? (
                              <p className="mt-1 pl-5 text-xs leading-5 text-muted-foreground/72">
                                {preview}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                <div className="min-w-0">
                  {selectedPath ? (
                    <WorkspaceBreadcrumb
                      path={selectedPath}
                      workspaceRoot={workspaceRoot}
                      onOpen={() => openArtifactInNativeApp(selectedPath)}
                    />
                  ) : (
                    <p className="truncate text-sm font-medium text-foreground/90">
                      No file selected
                    </p>
                  )}
                  {selectedDescriptor ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/68">
                      <span>{selectedDescriptor.typeLabel}</span>
                      {selectedArtifact ? (
                        <>
                          <span className={statusToneClass(selectedArtifact.status)}>
                            {selectedArtifact.status}
                          </span>
                          <span>{formatTimestamp(selectedArtifact.completedAt, timestampFormat)}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {selectedPath ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selectedDocumentText ? (
                      <Button size="xs" variant="secondary" onClick={addSelectedTextToChat}>
                        Add to chat
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => openArtifactInNativeApp(selectedPath)}
                    >
                      Open in app
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => openArtifact(selectedPath)}>
                      Open in editor
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1">
                {!selectedPath ? (
                  <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground/72">
                    Select a file from the workspace to preview it here.
                  </div>
                ) : selectedDescriptor?.previewKind === "text" ? (
                  <ScrollArea className="h-full">
                    <div
                      ref={documentSelectionContainerRef}
                      className="space-y-3 p-4"
                      onMouseUp={syncSelectedDocumentText}
                      onKeyUp={syncSelectedDocumentText}
                    >
                      {textFileQuery.isLoading ? (
                        <div className="rounded-2xl border border-border/55 bg-background/55 p-4 text-sm text-muted-foreground/72">
                          Loading document preview...
                        </div>
                      ) : selectedDocumentContent ? (
                        activeDocumentViewMode === "preview" && selectedDescriptor.category === "note" ? (
                          <div className="rounded-2xl border border-border/55 bg-background/70 p-5">
                            <ChatMarkdown
                              cwd={markdownCwd}
                              text={selectedDocumentContent}
                              onOpenWorkspaceFile={openWorkspaceFileFromLink}
                            />
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-border/55 bg-background/70 p-4">
                            <pre
                              className={cn(
                                "overflow-x-auto whitespace-pre-wrap text-foreground/88",
                                activeDocumentViewMode === "code"
                                  ? "font-mono text-[12px] leading-6"
                                  : "text-sm leading-7",
                              )}
                            >
                              {selectedDocumentContent}
                            </pre>
                          </div>
                        )
                      ) : (
                        <div className="rounded-2xl border border-border/55 bg-background/55 p-4 text-sm text-muted-foreground/72">
                          This file does not have a text preview yet.
                        </div>
                      )}
                      {selectedDocumentTruncated ? (
                        <div className="rounded-xl border border-border/50 bg-background/50 px-3 py-2 text-xs text-muted-foreground/70">
                          Preview truncated for speed. Open the file in your editor for the full
                          contents.
                        </div>
                      ) : null}
                      {selectedArtifact?.turnId && onOpenTurnDiff ? (
                        <div className="flex justify-end">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onOpenTurnDiff(selectedArtifact.turnId!, selectedPath)}
                          >
                            <FileSearchIcon className="size-3.5" />
                            Inspect changes
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex h-full items-center justify-center p-6">
                    <div className="max-w-md rounded-2xl border border-border/55 bg-background/60 p-5">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl border border-border/50 bg-card/80 p-2">
                          <VscodeEntryIcon
                            pathValue={selectedPath}
                            kind="file"
                            theme={resolvedTheme}
                            className="size-5 text-muted-foreground/80"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground/88">
                            This file opens best in its native app
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground/72">
                            Use Open in app for the native viewer or Open in editor if you need the
                            source directly.
                          </p>
                          <div className="mt-4 flex gap-2">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => openArtifactInNativeApp(selectedPath)}
                            >
                              <ExternalLinkIcon className="size-3.5" />
                              Open in app
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => openArtifact(selectedPath)}
                            >
                              Open in editor
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {fileTreeOpen ? (
          <div className="flex min-h-0 w-[320px] shrink-0 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/90">{workspaceRootLabel}</p>
                <p className="truncate text-[11px] text-muted-foreground/65">
                  {workspaceRoot ?? "Workspace path unavailable"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={revealWorkspaceRoot}
                  disabled={!workspaceRoot}
                  aria-label="Open workspace folder"
                  title="Open workspace folder"
                  className="gap-1.5 rounded-full border border-blue-200/80 bg-blue-500/10 px-2.5 text-blue-600 hover:bg-blue-500/14 dark:border-blue-400/30 dark:text-blue-300"
                >
                  <FolderKanbanIcon className="size-3.5" />
                  Workspace
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setFileTreeOpen(false)}
                  aria-label="Hide files list"
                  title="Hide files list"
                  className="text-muted-foreground/50 hover:text-foreground/70"
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-3">
                {recentArtifacts.length > 0 ? (
                  <div className="rounded-2xl border border-border/55 bg-background/55 p-3">
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground/55 uppercase">
                      Recent outputs
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {recentArtifacts.slice(0, 4).map((artifact) => (
                        <button
                          key={`recent:${artifact.id}`}
                          type="button"
                          onClick={() => selectWorkspaceFile(artifact.path)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/84 transition-colors hover:bg-background/80"
                        >
                          <FolderOutputIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
                          <span className="min-w-0 flex-1 truncate">
                            {formatWorkspaceRelativePath(artifact.path, workspaceRoot)}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-medium",
                              statusToneClass(artifact.status),
                            )}
                          >
                            {artifact.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {workspaceEntriesQuery.data?.entries.length ? (
                  <div className="rounded-2xl border border-border/55 bg-background/55 p-2">
                    <WorkspaceTree
                      nodes={workspaceTree}
                      expandedDirectories={expandedDirectories}
                      selectedPath={selectedPath}
                      resolvedTheme={resolvedTheme}
                      onToggleDirectory={(path) =>
                        setExpandedDirectories((current) => {
                          const next = new Set(current);
                          if (next.has(path)) {
                            next.delete(path);
                          } else {
                            next.add(path);
                          }
                          return next;
                        })
                      }
                      onSelectFile={selectWorkspaceFile}
                    />
                  </div>
                ) : workspaceEntriesQuery.isLoading ? (
                  <div className="rounded-2xl border border-border/55 bg-background/55 p-4 text-sm text-muted-foreground/72">
                    Building the workspace tree...
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/45 p-4 text-sm leading-6 text-muted-foreground/72">
                    Files will appear here once the workspace is available.
                  </div>
                )}

                {(selectedArtifact?.turnId || firstDiffCapableArtifact?.turnId) && onOpenTurnDiff ? (
                  <div className="rounded-2xl border border-border/55 bg-background/55 p-3">
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground/55 uppercase">
                      Advanced
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedArtifact?.turnId ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            onOpenTurnDiff(selectedArtifact.turnId!, selectedArtifact.path)
                          }
                        >
                          <FileSearchIcon className="size-3.5" />
                          Selected file diff
                        </Button>
                      ) : null}
                      {firstDiffCapableArtifact?.turnId ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => onOpenTurnDiff(firstDiffCapableArtifact.turnId!)}
                        >
                          Full diff viewer
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default WorkspacePanel;
