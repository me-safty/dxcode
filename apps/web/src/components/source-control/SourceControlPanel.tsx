import type {
  EnvironmentId,
  ThreadId,
  VcsPanelBranchDetails,
  VcsPanelChangeGroup,
  VcsPanelCommitSummary,
  VcsPanelFileChange,
  VcsPanelRemote,
  VcsPanelSnapshotResult,
  VcsPanelStash,
  VcsPanelStashDetails,
  VcsRef,
} from "@t3tools/contracts";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  GitBranch,
  GitCommit,
  GitCompare,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  UploadCloud,
} from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openInPreferredEditor } from "~/editorPreferences";
import { readEnvironmentApi } from "~/environmentApi";
import { readLocalApi } from "~/localApi";
import { invalidateSourceControlState, useGitStackedAction } from "~/lib/sourceControlActions";
import { cn, newCommandId } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SourceControlPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly worktreePath: string | null;
}

type SectionKey = "changes" | "branches" | "remotes" | "stashes";

const SECTION_ORDER: readonly SectionKey[] = ["changes", "branches", "remotes", "stashes"];

const SECTION_TITLES: Record<SectionKey, string> = {
  changes: "Changes",
  branches: "Branches",
  remotes: "Remotes",
  stashes: "Stashes",
};

const DEFAULT_SECTION_WEIGHTS: Record<SectionKey, number> = {
  changes: 2.4,
  branches: 2,
  remotes: 1.5,
  stashes: 1.4,
};

const COLLAPSED_SECTION_HEIGHT = 32;
const MIN_SECTION_WEIGHT = 0.35;
const ACTION_LOCK_TIMEOUT_MS = 15_000;
const COMMIT_PAGE_SIZE = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Source control action failed.";
}

function formatBranchSync(snapshot: VcsPanelSnapshotResult): string {
  const status = snapshot.status;
  if (!status.hasUpstream) return "No upstream";
  if (status.aheadCount === 0 && status.behindCount === 0) return "Synced";
  const parts = [];
  if (status.aheadCount > 0) parts.push(`${status.aheadCount} ahead`);
  if (status.behindCount > 0) parts.push(`${status.behindCount} behind`);
  return parts.join(", ");
}

function fileCountLabel(groups: readonly VcsPanelChangeGroup[]): string {
  const count = groups.reduce((sum, group) => sum + group.files.length, 0);
  return count === 1 ? "1 file" : `${count} files`;
}

function isActionForced(event: ReactMouseEvent): boolean {
  return event.shiftKey;
}

function shouldFetchBeforePull(event: ReactMouseEvent): boolean {
  return event.altKey;
}

function treeKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function changeGroupStashMode(kind: VcsPanelChangeGroup["kind"]): "staged" | "unstaged" | null {
  if (kind === "staged") return "staged";
  if (kind === "unstaged") return "unstaged";
  return null;
}

function shortRemoteBranchName(details: VcsPanelBranchDetails): string {
  return details.remoteName && details.fullRefName.startsWith(`${details.remoteName}/`)
    ? details.fullRefName.slice(details.remoteName.length + 1)
    : details.name;
}

function mapBranchDetails(
  details: readonly VcsPanelBranchDetails[],
): ReadonlyMap<string, VcsPanelBranchDetails> {
  const map = new Map<string, VcsPanelBranchDetails>();
  for (const detail of details) {
    map.set(detail.fullRefName, detail);
    map.set(detail.name, detail);
  }
  return map;
}

function remoteBranchRef(
  remote: VcsPanelRemote,
  branch: VcsPanelRemote["branches"][number],
): VcsRef {
  return {
    name: branch.fullRefName,
    isRemote: true,
    remoteName: remote.name,
    current: false,
    isDefault: branch.isDefaultRemoteHead,
    worktreePath: null,
  };
}

function expandedBranchesForSnapshot(
  snapshot: VcsPanelSnapshotResult,
  expanded: ReadonlySet<string>,
): VcsRef[] {
  const localBranches = snapshot.localBranches.filter((branch) =>
    expanded.has(treeKey("branch", branch.name)),
  );
  const remoteBranches = snapshot.remotes.flatMap((remote) =>
    remote.branches
      .map((branch) => remoteBranchRef(remote, branch))
      .filter((branch) => expanded.has(treeKey("remote-branch", branch.name))),
  );
  return [...localBranches, ...remoteBranches];
}

function StatLabels({
  insertions,
  deletions,
}: {
  readonly insertions: number;
  readonly deletions: number;
}) {
  if (insertions === 0 && deletions === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
      {insertions > 0 ? <span className="text-success-foreground">+{insertions}</span> : null}
      {deletions > 0 ? <span className="text-destructive-foreground">-{deletions}</span> : null}
    </span>
  );
}

function IconButton({
  label,
  children,
  disabled,
  destructive,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            className={cn(
              "size-6",
              destructive && "text-destructive-foreground hover:text-destructive-foreground",
            )}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function CompactBadge({ children }: { readonly children: ReactNode }) {
  return (
    <span className="rounded border border-border/70 px-1 text-[10px] leading-4 text-muted-foreground">
      {children}
    </span>
  );
}

function fileStatusLetter(status: VcsPanelFileChange["status"]): string {
  switch (status) {
    case "added":
    case "untracked":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "conflicted":
      return "U";
    case "modified":
      return "M";
  }
}

function fileStatusColor(status: VcsPanelFileChange["status"]): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-success-foreground";
    case "deleted":
    case "conflicted":
      return "text-destructive-foreground";
    default:
      return "text-muted-foreground";
  }
}

function CollapsibleSection({
  sectionKey,
  title,
  collapsed,
  weight,
  onToggle,
  onResizeStart,
  children,
  action,
}: {
  readonly sectionKey: SectionKey;
  readonly title: string;
  readonly collapsed: boolean;
  readonly weight: number;
  readonly onToggle: () => void;
  readonly onResizeStart: (key: SectionKey, event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section
      data-source-control-section={sectionKey}
      className="flex min-h-0 flex-col overflow-hidden border-b border-border/70"
      style={
        collapsed
          ? { flex: `0 0 ${COLLAPSED_SECTION_HEIGHT}px` }
          : { flex: `${weight} 1 0`, minHeight: 0 }
      }
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          <span className="truncate">{title}</span>
        </button>
        {action}
      </div>
      {!collapsed ? (
        <div data-source-control-section-content className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {children}
        </div>
      ) : null}
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title}`}
          className="h-1 shrink-0 cursor-row-resize hover:bg-border"
          onMouseDown={(event) => onResizeStart(sectionKey, event)}
        />
      ) : null}
    </section>
  );
}

function BranchBadge({ snapshot }: { readonly snapshot: VcsPanelSnapshotResult }) {
  const status = snapshot.status;
  if (!status.hasUpstream) {
    return (
      <Badge variant="warning" size="sm">
        No upstream
      </Badge>
    );
  }
  if (status.aheadCount === 0 && status.behindCount === 0) {
    return (
      <Badge variant="success" size="sm">
        Synced
      </Badge>
    );
  }
  return (
    <Badge variant={status.behindCount > 0 ? "warning" : "info"} size="sm">
      {formatBranchSync(snapshot)}
    </Badge>
  );
}

function sumFiles(files: readonly VcsPanelFileChange[]) {
  return files.reduce(
    (total, file) => ({
      insertions: total.insertions + file.insertions,
      deletions: total.deletions + file.deletions,
    }),
    { insertions: 0, deletions: 0 },
  );
}

function FileChangeList({
  files,
  emptyLabel,
}: {
  readonly files: readonly VcsPanelFileChange[];
  readonly emptyLabel: string;
}) {
  if (files.length === 0) {
    return <div className="px-3 py-1 text-xs text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="space-y-0.5">
      {files.map((file) => (
        <div
          key={`${file.path}:${file.status}`}
          className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
        >
          <span
            className={cn(
              "w-3 shrink-0 text-center text-[10px] font-semibold uppercase",
              fileStatusColor(file.status),
            )}
          >
            {fileStatusLetter(file.status)}
          </span>
          <span className="min-w-0 flex-1 truncate">{file.path}</span>
          <StatLabels insertions={file.insertions} deletions={file.deletions} />
        </div>
      ))}
    </div>
  );
}

export function SourceControlPanel({
  cwd,
  environmentId,
  threadId,
  worktreePath,
}: SourceControlPanelProps) {
  const api = useMemo(() => readEnvironmentApi(environmentId), [environmentId]);
  const gitActionScope = useMemo(() => ({ environmentId, cwd }), [cwd, environmentId]);
  const gitAction = useGitStackedAction(gitActionScope);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const expandedTreeRef = useRef<ReadonlySet<string>>(new Set());
  const lastFocusRefreshAtRef = useRef(0);
  const [snapshot, setSnapshot] = useState<VcsPanelSnapshotResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionRunning, setActionRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(() => new Set(["stashes"]));
  const [sectionWeights, setSectionWeights] = useState(DEFAULT_SECTION_WEIGHTS);
  const [expandedTree, setExpandedTree] = useState<ReadonlySet<string>>(() => new Set());
  const [branchDetailsByRef, setBranchDetailsByRef] = useState<
    ReadonlyMap<string, VcsPanelBranchDetails>
  >(() => new Map());
  const [loadingBranchDetails, setLoadingBranchDetails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [stashDetailsByRef, setStashDetailsByRef] = useState<
    ReadonlyMap<string, VcsPanelStashDetails>
  >(() => new Map());
  const [loadingStashDetails, setLoadingStashDetails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const stagedFiles = snapshot?.changeGroups.find((group) => group.kind === "staged")?.files ?? [];

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const nextSnapshot = await api.vcs.panelSnapshot({ cwd });
      setSnapshot(nextSnapshot);
      const expandedBranches = expandedBranchesForSnapshot(nextSnapshot, expandedTreeRef.current);
      const nextDetails = new Map(mapBranchDetails(nextSnapshot.branchDetails));
      setLoadingBranchDetails(new Set());
      if (expandedBranches.length > 0) {
        setLoadingBranchDetails(new Set(expandedBranches.map((branch) => branch.name)));
        const details = await Promise.all(
          expandedBranches.map((branch) =>
            api.vcs.branchDetails({
              cwd,
              branch,
              defaultCompareRef: nextSnapshot.defaultCompareRef,
            }),
          ),
        );
        for (const detail of details) {
          nextDetails.set(detail.fullRefName, detail);
          nextDetails.set(detail.name, detail);
        }
      }
      setBranchDetailsByRef(nextDetails);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoadingBranchDetails(new Set());
      setLoading(false);
    }
  }, [api, cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    expandedTreeRef.current = expandedTree;
  }, [expandedTree]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 1_000) return;
      lastFocusRefreshAtRef.current = now;
      void refresh();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refresh]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setActionRunning(true);
      setError(null);
      let timeoutId: number | null = window.setTimeout(() => {
        timeoutId = null;
        setActionRunning(false);
        void refresh();
      }, ACTION_LOCK_TIMEOUT_MS);
      try {
        await action();
        void invalidateSourceControlState({ environmentId, cwd });
        await refresh();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        setActionRunning(false);
      }
    },
    [cwd, environmentId, refresh],
  );

  const openFile = useCallback(
    async (path: string) => {
      const localApi = readLocalApi();
      if (!localApi) {
        setError("No local editor bridge is available.");
        return;
      }
      try {
        await openInPreferredEditor(localApi, resolvePathLinkTarget(path, cwd));
      } catch (nextError) {
        setError(errorMessage(nextError));
      }
    },
    [cwd],
  );

  const confirm = useCallback(async (message: string) => {
    return (await readLocalApi()?.dialogs.confirm(message)) ?? window.confirm(message);
  }, []);

  const switchRef = useCallback(
    (refName: string) =>
      runAction(async () => {
        if (!api) return;
        const result = await api.vcs.switchRef({ cwd, refName });
        await readEnvironmentApi(environmentId)?.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          branch: result.refName,
          worktreePath,
        });
      }),
    [api, cwd, environmentId, runAction, threadId, worktreePath],
  );

  const runPanelCommit = useCallback(
    () =>
      runAction(async () => {
        const commitMessage = dialogCommitMessage.trim();
        setCommitDialogOpen(false);
        setDialogCommitMessage("");
        await gitAction.run({
          actionId: newCommandId(),
          action: "commit",
          ...(commitMessage ? { commitMessage } : {}),
        });
      }),
    [dialogCommitMessage, gitAction, runAction],
  );

  const createStash = useCallback(
    (mode: "staged" | "unstaged") =>
      runAction(async () => {
        if (!api) return;
        await api.vcs.createStash({
          cwd,
          mode,
          includeUntracked: mode === "unstaged",
          message: `T3 Code ${mode} stash`,
        });
      }),
    [api, cwd, runAction],
  );

  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleTree = useCallback((key: string) => {
    setExpandedTree((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadBranchDetails = useCallback(
    async (branch: VcsRef) => {
      if (!api || !snapshot || branchDetailsByRef.has(branch.name)) return;
      setLoadingBranchDetails((current) => {
        const next = new Set(current);
        next.add(branch.name);
        return next;
      });
      try {
        const details = await api.vcs.branchDetails({
          cwd,
          branch,
          defaultCompareRef: snapshot.defaultCompareRef,
        });
        setBranchDetailsByRef((current) => {
          const next = new Map(current);
          next.set(details.fullRefName, details);
          next.set(details.name, details);
          return next;
        });
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setLoadingBranchDetails((current) => {
          const next = new Set(current);
          next.delete(branch.name);
          return next;
        });
      }
    },
    [api, branchDetailsByRef, cwd, snapshot],
  );

  const toggleBranchTree = useCallback(
    (key: string, branch: VcsRef) => {
      const expanding = !expandedTree.has(key);
      toggleTree(key);
      if (expanding) void loadBranchDetails(branch);
    },
    [expandedTree, loadBranchDetails, toggleTree],
  );

  const toggleBranchTreeFromKeyboard = useCallback(
    (key: string, branch: VcsRef, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleBranchTree(key, branch);
    },
    [toggleBranchTree],
  );

  const loadMoreBranchCommits = useCallback(
    async (branch: VcsRef, details: VcsPanelBranchDetails) => {
      if (!api || details.commitsRemaining <= 0) return;
      setLoadingBranchDetails((current) => {
        const next = new Set(current);
        next.add(branch.name);
        return next;
      });
      try {
        const result = await api.vcs.branchCommits({
          cwd,
          branch,
          skip: details.commits.length,
          limit: COMMIT_PAGE_SIZE,
        });
        setBranchDetailsByRef((current) => {
          const nextDetails = current.get(details.fullRefName) ?? details;
          const merged = {
            ...nextDetails,
            commits: [...nextDetails.commits, ...result.commits],
            commitsRemaining: result.remaining,
          };
          const next = new Map(current);
          next.set(merged.fullRefName, merged);
          next.set(merged.name, merged);
          return next;
        });
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setLoadingBranchDetails((current) => {
          const next = new Set(current);
          next.delete(branch.name);
          return next;
        });
      }
    },
    [api, cwd],
  );

  const loadStashDetails = useCallback(
    async (stashRef: string) => {
      if (!api || stashDetailsByRef.has(stashRef)) return;
      setLoadingStashDetails((current) => {
        const next = new Set(current);
        next.add(stashRef);
        return next;
      });
      try {
        const details = await api.vcs.stashDetails({ cwd, stashRef });
        setStashDetailsByRef((current) => {
          const next = new Map(current);
          next.set(details.refName, details);
          return next;
        });
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setLoadingStashDetails((current) => {
          const next = new Set(current);
          next.delete(stashRef);
          return next;
        });
      }
    },
    [api, cwd, stashDetailsByRef],
  );

  const toggleStashTree = useCallback(
    (key: string, stashRef: string) => {
      const expanding = !expandedTree.has(key);
      toggleTree(key);
      if (expanding) void loadStashDetails(stashRef);
    },
    [expandedTree, loadStashDetails, toggleTree],
  );

  const toggleTreeFromKeyboard = useCallback(
    (key: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleTree(key);
    },
    [toggleTree],
  );

  const startSectionResize = useCallback(
    (key: SectionKey, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const openKeys = SECTION_ORDER.filter((sectionKey) => !collapsed.has(sectionKey));
      const index = openKeys.indexOf(key);
      if (index < 0 || openKeys.length < 2) return;
      const adjacentKey = openKeys[index + 1] ?? openKeys[index - 1];
      if (!adjacentKey) return;
      const direction = openKeys[index + 1] ? 1 : -1;
      const startY = event.clientY;
      const startCurrent = sectionWeights[key];
      const startAdjacent = sectionWeights[adjacentKey];
      const total = startCurrent + startAdjacent;
      const containerHeight = Math.max(containerRef.current?.clientHeight ?? 1, 1);
      const onMove = (moveEvent: MouseEvent) => {
        const deltaWeight = ((moveEvent.clientY - startY) / containerHeight) * total * direction;
        const nextCurrent = Math.min(
          total - MIN_SECTION_WEIGHT,
          Math.max(MIN_SECTION_WEIGHT, startCurrent + deltaWeight),
        );
        setSectionWeights((current) => ({
          ...current,
          [key]: nextCurrent,
          [adjacentKey]: total - nextCurrent,
        }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [collapsed, sectionWeights],
  );

  const section = (key: SectionKey, children: ReactNode, action?: ReactNode) => (
    <CollapsibleSection
      key={key}
      sectionKey={key}
      title={SECTION_TITLES[key]}
      collapsed={collapsed.has(key)}
      weight={sectionWeights[key]}
      onToggle={() => toggleSection(key)}
      onResizeStart={startSectionResize}
      action={action}
    >
      {children}
    </CollapsibleSection>
  );

  if (loading && !snapshot) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading repository state...
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="text-sm text-destructive-foreground">
          {error ?? "Source control is unavailable."}
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
    );
  }

  const renderWorkingFile = (file: VcsPanelFileChange, groupKind: VcsPanelChangeGroup["kind"]) => {
    const staged = groupKind === "staged";
    return (
      <div
        key={`${groupKind}:${file.path}`}
        className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
      >
        <span
          className={cn(
            "w-3 shrink-0 text-center text-[10px] font-semibold uppercase",
            fileStatusColor(file.status),
          )}
        >
          {fileStatusLetter(file.status)}
        </span>
        <span className="min-w-0 flex-1 truncate">{file.path}</span>
        <StatLabels insertions={file.insertions} deletions={file.deletions} />
        <div className="flex shrink-0 items-center gap-0.5">
          {staged ? (
            <IconButton
              label="Unstage file"
              disabled={actionRunning}
              onClick={() =>
                void runAction(
                  () => api?.vcs.unstageFiles({ cwd, paths: [file.path] }) ?? Promise.resolve(),
                )
              }
            >
              <Undo2 className="size-3.5" />
            </IconButton>
          ) : (
            <IconButton
              label="Stage file"
              disabled={actionRunning}
              onClick={() =>
                void runAction(
                  () => api?.vcs.stageFiles({ cwd, paths: [file.path] }) ?? Promise.resolve(),
                )
              }
            >
              <Plus className="size-3.5" />
            </IconButton>
          )}
          <IconButton
            label="Discard file"
            destructive
            disabled={actionRunning}
            onClick={() =>
              void (async () => {
                if (!(await confirm(`Discard changes in ${file.path}?`))) return;
                await runAction(
                  () =>
                    api?.vcs.discardFiles({ cwd, paths: [file.path], staged }) ?? Promise.resolve(),
                );
              })()
            }
          >
            <Trash2 className="size-3.5" />
          </IconButton>
          <IconButton label="Open file" onClick={() => void openFile(file.path)}>
            <ExternalLink className="size-3.5" />
          </IconButton>
        </div>
      </div>
    );
  };

  const renderCommit = (commit: VcsPanelCommitSummary) => {
    const key = treeKey("commit", commit.sha);
    const expanded = expandedTree.has(key);
    const stats = sumFiles(commit.files);
    return (
      <div key={commit.sha} className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-xs hover:bg-accent/60"
          onClick={() => toggleTree(key)}
          onKeyDown={(event) => toggleTreeFromKeyboard(key, event)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 font-mono text-muted-foreground">{commit.shortSha}</span>
          <span className="min-w-0 flex-1 truncate">{commit.message}</span>
          <StatLabels insertions={stats.insertions} deletions={stats.deletions} />
        </div>
        {expanded ? (
          <div className="ml-2 border-l border-border/60 pl-1">
            <FileChangeList files={commit.files} emptyLabel="No file changes." />
          </div>
        ) : null}
      </div>
    );
  };

  const renderBranchSubsection = ({
    details,
    id,
    title,
    count,
    children,
    icon,
  }: {
    readonly details: VcsPanelBranchDetails;
    readonly id: string;
    readonly title: ReactNode;
    readonly count: number | null;
    readonly children: ReactNode;
    readonly icon?: ReactNode;
  }) => {
    const key = treeKey("branch-subsection", `${details.fullRefName}:${id}`);
    const expanded = expandedTree.has(key);
    return (
      <div className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs hover:bg-accent/60"
          onClick={() => toggleTree(key)}
          onKeyDown={(event) => toggleTreeFromKeyboard(key, event)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {icon}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count !== null ? <span className="shrink-0 text-muted-foreground">{count}</span> : null}
        </div>
        {expanded ? <div className="ml-2 border-l border-border/60 pl-1">{children}</div> : null}
      </div>
    );
  };

  const renderBranchTree = (branch: VcsRef, details: VcsPanelBranchDetails) => (
    <div className="ml-2 space-y-0.5 border-l border-border/60 pl-1">
      {details.compareFiles.length > 0
        ? renderBranchSubsection({
            details,
            id: "compare",
            title: (
              <>
                Compare
                {details.baseRef ? (
                  <span className="ml-1 text-muted-foreground">vs {details.baseRef}</span>
                ) : null}
              </>
            ),
            count: details.compareFiles.length,
            icon: <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />,
            children: <FileChangeList files={details.compareFiles} emptyLabel="No changes." />,
          })
        : null}
      {details.aheadCommits.length > 0
        ? renderBranchSubsection({
            details,
            id: "ahead",
            title: "Ahead",
            count: details.aheadCommits.length,
            children: details.aheadCommits.map(renderCommit),
          })
        : null}
      {details.behindCommits.length > 0
        ? renderBranchSubsection({
            details,
            id: "behind",
            title: "Behind",
            count: details.behindCommits.length,
            children: details.behindCommits.map(renderCommit),
          })
        : null}
      {renderBranchSubsection({
        details,
        id: "commits",
        title: "Commits",
        count: details.commits.length,
        children: (
          <div className="space-y-0.5">
            {details.commits.length === 0 ? (
              <div className="px-3 py-1 text-xs text-muted-foreground">No commits.</div>
            ) : (
              details.commits.map(renderCommit)
            )}
            {details.commitsRemaining > 0 ? (
              <button
                type="button"
                className="flex h-7 w-full items-center rounded px-1.5 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                disabled={loadingBranchDetails.has(branch.name)}
                onClick={() => void loadMoreBranchCommits(branch, details)}
              >
                Load {Math.min(COMMIT_PAGE_SIZE, details.commitsRemaining)} more of{" "}
                {details.commitsRemaining} previous commits
              </button>
            ) : null}
          </div>
        ),
      })}
    </div>
  );

  const branchRow = (branch: VcsRef) => {
    const details = branchDetailsByRef.get(branch.name);
    const key = treeKey("branch", branch.name);
    const expanded = expandedTree.has(key);
    const loadingDetails = loadingBranchDetails.has(branch.name);
    const current = branch.current;
    const shouldPull = current && snapshot.status.hasUpstream && snapshot.status.behindCount > 0;
    return (
      <div key={branch.name} className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-xs hover:bg-accent/60"
          onClick={() => toggleBranchTree(key, branch)}
          onKeyDown={(event) => toggleBranchTreeFromKeyboard(key, branch, event)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{branch.name}</span>
          {current ? <CompactBadge>current</CompactBadge> : null}
          {branch.isDefault ? <CompactBadge>default</CompactBadge> : null}
          <div
            className="flex shrink-0 items-center gap-0.5"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Switch branch"
              disabled={current || actionRunning}
              onClick={() => void switchRef(branch.name)}
            >
              <GitBranch className="size-3.5" />
            </IconButton>
            <IconButton
              label={shouldPull ? "Pull. Shift: reset. Option: fetch first." : "Fetch"}
              disabled={actionRunning}
              onClick={(event) =>
                void runAction(async () => {
                  if (!api) return;
                  if (!shouldPull) {
                    await api.vcs.fetchAllRemotes({ cwd });
                    return;
                  }
                  if (shouldFetchBeforePull(event)) {
                    await api.vcs.fetchAllRemotes({ cwd });
                  }
                  await api.vcs.pullBranch({
                    cwd,
                    branchName: branch.name,
                    force: isActionForced(event),
                  });
                })
              }
            >
              {shouldPull ? <Download className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Push. Shift: force-with-lease."
              disabled={!current || actionRunning}
              onClick={(event) =>
                void runAction(
                  () =>
                    api?.vcs.pushBranch({
                      cwd,
                      branchName: branch.name,
                      force: isActionForced(event),
                    }) ?? Promise.resolve(),
                )
              }
            >
              <UploadCloud className="size-3.5" />
            </IconButton>
          </div>
        </div>
        {expanded && details ? renderBranchTree(branch, details) : null}
        {expanded && !details && loadingDetails ? (
          <div className="ml-2 border-l border-border/60 px-2 py-1 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : null}
      </div>
    );
  };

  const remoteBranchRow = (branch: VcsRef) => {
    const details = branchDetailsByRef.get(branch.name);
    const key = treeKey("remote-branch", branch.name);
    const expanded = expandedTree.has(key);
    const loadingDetails = loadingBranchDetails.has(branch.name);
    return (
      <div key={branch.name} className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-xs hover:bg-accent/60"
          onClick={() => toggleBranchTree(key, branch)}
          onKeyDown={(event) => toggleBranchTreeFromKeyboard(key, branch, event)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {details
              ? shortRemoteBranchName(details)
              : branch.name.replace(`${branch.remoteName}/`, "")}
          </span>
          {branch.isDefault ? <CompactBadge>default</CompactBadge> : null}
        </div>
        {expanded && details ? renderBranchTree(branch, details) : null}
        {expanded && !details && loadingDetails ? (
          <div className="ml-2 border-l border-border/60 px-2 py-1 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : null}
      </div>
    );
  };

  const remoteRow = (remote: VcsPanelRemote) => {
    const key = treeKey("remote", remote.name);
    const expanded = expandedTree.has(key);
    return (
      <div key={remote.name} className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-xs hover:bg-accent/60"
          onClick={() => toggleTree(key)}
          onKeyDown={(event) => toggleTreeFromKeyboard(key, event)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{remote.name}</span>
          <span className="min-w-0 flex-[2] truncate text-muted-foreground">
            {remote.fetchUrl ?? "No fetch URL"}
          </span>
          <div
            className="flex shrink-0 items-center gap-0.5"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Fetch remote"
              disabled={actionRunning}
              onClick={() =>
                void runAction(
                  () => api?.vcs.fetchRemote({ cwd, remoteName: remote.name }) ?? Promise.resolve(),
                )
              }
            >
              <RefreshCw className="size-3.5" />
            </IconButton>
            <IconButton
              label="Remove remote"
              destructive
              disabled={actionRunning}
              onClick={() =>
                void (async () => {
                  if (!(await confirm(`Remove remote ${remote.name}?`))) return;
                  await runAction(
                    () =>
                      api?.vcs.removeRemote({ cwd, remoteName: remote.name }) ?? Promise.resolve(),
                  );
                })()
              }
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </div>
        {expanded ? (
          <div className="ml-2 space-y-0.5 border-l border-border/60 pl-1">
            {remote.branches.length === 0 ? (
              <div className="px-1.5 py-1 text-xs text-muted-foreground">No remote branches.</div>
            ) : (
              remote.branches.map((branch) => {
                return remoteBranchRow(remoteBranchRef(remote, branch));
              })
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const stashRow = (stash: VcsPanelStash) => {
    const key = treeKey("stash", stash.refName);
    const expanded = expandedTree.has(key);
    const details = stashDetailsByRef.get(stash.refName);
    const loadingDetails = loadingStashDetails.has(stash.refName);
    return (
      <div key={stash.refName} className="space-y-0.5">
        <div
          role="button"
          tabIndex={0}
          className="flex h-7 min-w-0 items-center justify-between gap-1.5 rounded px-1.5 text-xs hover:bg-accent/60"
          onClick={() => toggleStashTree(key, stash.refName)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggleStashTree(key, stash.refName);
          }}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{stash.message}</span>
          <span className="shrink-0 font-mono text-muted-foreground">{stash.refName}</span>
          <div
            className="flex shrink-0 items-center gap-0.5"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Apply stash"
              disabled={actionRunning}
              onClick={() =>
                void runAction(
                  () => api?.vcs.applyStash({ cwd, stashRef: stash.refName }) ?? Promise.resolve(),
                )
              }
            >
              <Download className="size-3.5" />
            </IconButton>
            <IconButton
              label="Pop stash"
              disabled={actionRunning}
              onClick={() =>
                void runAction(
                  () => api?.vcs.popStash({ cwd, stashRef: stash.refName }) ?? Promise.resolve(),
                )
              }
            >
              <Archive className="size-3.5" />
            </IconButton>
            <IconButton
              label="Drop stash"
              destructive
              disabled={actionRunning}
              onClick={() =>
                void (async () => {
                  if (!(await confirm(`Drop ${stash.refName}?`))) return;
                  await runAction(
                    () => api?.vcs.dropStash({ cwd, stashRef: stash.refName }) ?? Promise.resolve(),
                  );
                })()
              }
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </div>
        {expanded && details ? (
          <div className="ml-2 border-l border-border/60 pl-1">
            <FileChangeList files={details.files} emptyLabel="No changes." />
          </div>
        ) : null}
        {expanded && !details && loadingDetails ? (
          <div className="ml-2 border-l border-border/60 px-2 py-1 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : null}
      </div>
    );
  };

  const repositorySummary = (
    <div className="shrink-0 border-b border-border/70 px-2 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium">
          {snapshot.status.refName ?? "Detached HEAD"}
        </span>
        <BranchBadge snapshot={snapshot} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>
          {snapshot.status.hasWorkingTreeChanges ? fileCountLabel(snapshot.changeGroups) : "Clean"}
        </span>
        <StatLabels
          insertions={snapshot.status.workingTree.insertions}
          deletions={snapshot.status.workingTree.deletions}
        />
        {snapshot.status.aheadOfDefaultCount ? (
          <span>{snapshot.status.aheadOfDefaultCount} ahead of default</span>
        ) : null}
      </div>
      {error ? <div className="mt-1 text-destructive-foreground">{error}</div> : null}
    </div>
  );

  const changesSection = (
    <div className="space-y-2">
      {snapshot.changeGroups.every((group) => group.files.length === 0) ? (
        <div className="px-1 py-1 text-sm text-muted-foreground">Working tree clean</div>
      ) : (
        snapshot.changeGroups.map((group) =>
          group.files.length === 0 ? null : (
            <div key={group.kind} className="space-y-0.5">
              <div className="flex h-6 items-center justify-between gap-2 text-xs font-medium uppercase text-muted-foreground">
                <span>{group.kind}</span>
                <div className="flex items-center gap-1">
                  <span>{group.files.length}</span>
                  {group.kind === "staged" && stagedFiles.length > 0 ? (
                    <IconButton
                      label="Commit staged changes"
                      disabled={actionRunning || gitAction.isPending}
                      onClick={() => setCommitDialogOpen(true)}
                    >
                      <GitCommit className="size-3.5" />
                    </IconButton>
                  ) : null}
                  {changeGroupStashMode(group.kind) ? (
                    <IconButton
                      label={`Stash ${group.kind} changes`}
                      disabled={actionRunning}
                      onClick={() => {
                        const mode = changeGroupStashMode(group.kind);
                        if (mode) void createStash(mode);
                      }}
                    >
                      <Archive className="size-3.5" />
                    </IconButton>
                  ) : null}
                </div>
              </div>
              {group.files.map((file) => renderWorkingFile(file, group.kind))}
            </div>
          ),
        )
      )}
    </div>
  );

  const branchesSection = (
    <div className="space-y-0.5">
      {snapshot.localBranches.length === 0 ? (
        <div className="text-sm text-muted-foreground">No local branches.</div>
      ) : (
        snapshot.localBranches.map(branchRow)
      )}
    </div>
  );

  const remotesSection = (
    <div className="space-y-0.5">
      {snapshot.remotes.length === 0 ? (
        <div className="text-sm text-muted-foreground">No remotes configured.</div>
      ) : (
        snapshot.remotes.map(remoteRow)
      )}
    </div>
  );

  const stashesSection = (
    <div className="space-y-0.5">
      {snapshot.stashes.length === 0 ? (
        <div className="text-sm text-muted-foreground">No stashes.</div>
      ) : (
        snapshot.stashes.map(stashRow)
      )}
    </div>
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {repositorySummary}
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {SECTION_ORDER.map((key) => {
            switch (key) {
              case "changes":
                return section(key, changesSection);
              case "branches":
                return section(key, branchesSection);
              case "remotes":
                return section(
                  key,
                  remotesSection,
                  <div className="flex items-center gap-0.5">
                    <IconButton
                      label="Fetch all remotes"
                      disabled={actionRunning}
                      onClick={() =>
                        void runAction(() => api?.vcs.fetchAllRemotes({ cwd }) ?? Promise.resolve())
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </IconButton>
                    <IconButton label="Add remote" onClick={() => setAddRemoteOpen(true)}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  </div>,
                );
              case "stashes":
                return section(key, stashesSection);
            }
          })}
        </div>
      </div>
      <Dialog open={addRemoteOpen} onOpenChange={setAddRemoteOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add remote</DialogTitle>
            <DialogDescription>Register a Git remote for this repository.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Input
              size="sm"
              value={remoteName}
              placeholder="origin"
              aria-label="Remote name"
              onChange={(event) => setRemoteName(event.currentTarget.value)}
            />
            <Input
              size="sm"
              value={remoteUrl}
              placeholder="git@github.com:owner/repo.git"
              aria-label="Remote URL"
              onChange={(event) => setRemoteUrl(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAddRemoteOpen(false);
                setRemoteName("");
                setRemoteUrl("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                actionRunning || remoteName.trim().length === 0 || remoteUrl.trim().length === 0
              }
              onClick={() =>
                void runAction(async () => {
                  if (!api) return;
                  await api.vcs.addRemote({ cwd, name: remoteName.trim(), url: remoteUrl.trim() });
                  setRemoteName("");
                  setRemoteUrl("");
                  setAddRemoteOpen(false);
                })
              }
            >
              Add
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Commit staged changes</DialogTitle>
            <DialogDescription>
              Provide a message, or leave it blank to auto-generate one.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="source-control-commit-message">
              Commit message (optional)
            </label>
            <Textarea
              id="source-control-commit-message"
              size="sm"
              value={dialogCommitMessage}
              placeholder="Leave empty to auto-generate"
              aria-label="Commit message (optional)"
              disabled={actionRunning || gitAction.isPending}
              onChange={(event) => setDialogCommitMessage(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCommitDialogOpen(false);
                setDialogCommitMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={stagedFiles.length === 0 || actionRunning || gitAction.isPending}
              onClick={() => void runPanelCommit()}
            >
              Commit
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
