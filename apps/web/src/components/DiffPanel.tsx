import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { useReviewDiffPreview } from "~/lib/reviewDiffPreviewState";
import { useVcsRefs } from "~/lib/vcsRefState";
import { useDiffRailState } from "~/lib/useDiffRailState";
import { useVcsStatus } from "~/lib/vcsStatusState";
import { cn } from "~/lib/utils";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { readLocalApi } from "../localApi";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { adaptFileDiffsToTreeChanges } from "../lib/diffFileTreeAdapter";
import { summarizeTurnDiffStats } from "../lib/turnDiffTree";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { useSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { DiffPanelBody } from "./DiffPanelBody";
import {
  DiffPanelToolbar,
  type DiffBranchOption,
  type DiffRenderMode,
  type DiffSourceSelection,
} from "./DiffPanelToolbar";

type DiffThemeType = "light" | "dark";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  min-height: 32px !important;
  padding-block: 6px !important;
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

interface DiffPanelProps {
  mode?: DiffPanelMode;
  active?: boolean;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline", active = true }: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  // Default to wrapping in the panel: it is a narrow side surface, so wrapping
  // keeps long lines readable instead of overflowing horizontally. Users can
  // still toggle it off from the toolbar.
  const [diffWordWrap, setDiffWordWrap] = useState(true);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const { railSize, railCollapsed, setRailSize, toggleRailCollapsed, minRailSize, maxRailSize } =
    useDiffRailState();
  const [collapsedDiffFileKeys, setCollapsedDiffFileKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const previousDiffOpenRef = useRef(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const gitStatusQuery = useVcsStatus({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd ?? null,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );
  const changedTurnDiffSummaries = useMemo(
    () => orderedTurnDiffSummaries.filter((summary) => summary.files.length > 0),
    [orderedTurnDiffSummaries],
  );
  // Map each turn to the user prompt that started it, for the Turns submenu.
  const turnPromptByTurnId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const message of activeThread?.messages ?? []) {
      if (message.role !== "user" || !message.turnId) continue;
      const text = message.text.trim();
      if (text.length > 0 && map[message.turnId] === undefined) {
        map[message.turnId] = text;
      }
    }
    return map;
  }, [activeThread?.messages]);
  const latestTurn = changedTurnDiffSummaries[0];
  const latestTurnId = latestTurn?.turnId ?? null;

  // Resolve the active diff source from the route. A specific `diffTurnId`
  // always wins (the "Turns" submenu selection); otherwise the `diffSource`
  // param is used, defaulting to the branch diff.
  const source = useMemo<DiffSourceSelection>(() => {
    if (diffSearch.diffTurnId) {
      return { kind: "turn", turnId: diffSearch.diffTurnId };
    }
    const param: DiffSourceParam = diffSearch.diffSource ?? "branch";
    switch (param) {
      case "working-tree":
        return { kind: "working-tree" };
      case "all-turns":
        return { kind: "all-turns" };
      case "last-turn":
        return { kind: "last-turn" };
      case "branch":
      default:
        return { kind: "branch", baseRef: diffSearch.diffBaseRef ?? null };
    }
  }, [diffSearch.diffBaseRef, diffSearch.diffSource, diffSearch.diffTurnId]);

  const selectedFilePath = diffSearch.diffFilePath ?? null;

  // Resolve which turn (if any) the checkpoint fetch should target.
  const checkpointTurn = useMemo(() => {
    if (source.kind === "turn") {
      return (
        changedTurnDiffSummaries.find((summary) => summary.turnId === source.turnId) ??
        changedTurnDiffSummaries[0]
      );
    }
    if (source.kind === "last-turn") {
      return latestTurn;
    }
    return undefined;
  }, [changedTurnDiffSummaries, latestTurn, source]);

  const selectedCheckpointTurnCount =
    checkpointTurn &&
    (checkpointTurn.checkpointTurnCount ??
      inferredCheckpointTurnCountByTurnId[checkpointTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts: Array<number> = [];
    for (const summary of orderedTurnDiffSummaries) {
      const value =
        summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
      if (typeof value === "number") {
        turnCounts.push(value);
      }
    }
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      source.kind === "all-turns" && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, source.kind],
  );

  const usesCheckpoint =
    source.kind === "turn" || source.kind === "last-turn" || source.kind === "all-turns";
  const usesReview = source.kind === "branch" || source.kind === "working-tree";
  const shouldLoadDiffData = active;

  const activeCheckpointRange = checkpointTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (checkpointTurn || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [checkpointTurn, orderedTurnDiffSummaries]);

  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: checkpointTurn ? `turn:${checkpointTurn.turnId}` : conversationCacheScope,
    },
    { enabled: shouldLoadDiffData && isGitRepo && usesCheckpoint },
  );

  const selectedBaseRef = source.kind === "branch" ? source.baseRef : null;
  const reviewDiff = useReviewDiffPreview(
    {
      environmentId: activeThread?.environmentId ?? null,
      cwd: activeCwd ?? null,
      baseRef: selectedBaseRef,
    },
    { enabled: shouldLoadDiffData && isGitRepo && usesReview },
  );
  const branchSource = useMemo(
    () => reviewDiff.data?.sources.find((entry) => entry.kind === "branch-range") ?? null,
    [reviewDiff.data],
  );
  const workingTreeSource = useMemo(
    () => reviewDiff.data?.sources.find((entry) => entry.kind === "working-tree") ?? null,
    [reviewDiff.data],
  );

  // Auto-refresh the working-tree / branch diffs when the repository state
  // changes. These come from `review.getDiffPreview` (a git snapshot) and have
  // no built-in invalidation, so we derive a cheap fingerprint from the live
  // VCS status (`vcs.onStatus`) and refresh when it changes. Turn diffs are
  // excluded — they already invalidate on turn completion.
  const reviewRefreshRef = useRef(reviewDiff.refresh);
  reviewRefreshRef.current = reviewDiff.refresh;
  const repoFingerprint = useMemo(() => {
    const status = gitStatusQuery.data;
    if (!status) return null;
    const workingTree = status.workingTree;
    return [
      status.refName ?? "",
      status.hasWorkingTreeChanges ? "dirty" : "clean",
      workingTree.insertions,
      workingTree.deletions,
      workingTree.files
        .map((file) => `${file.path}:${file.insertions}:${file.deletions}`)
        .join("|"),
      // Commits added/removed on the branch shift the base...HEAD range.
      status.aheadCount,
    ].join("\u0001");
  }, [gitStatusQuery.data]);
  const lastRepoFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldLoadDiffData || !usesReview || repoFingerprint === null) return;
    // Skip the first observed fingerprint: the SWR atom already loads on mount,
    // so we only refresh on a genuine change.
    if (lastRepoFingerprintRef.current === null) {
      lastRepoFingerprintRef.current = repoFingerprint;
      return;
    }
    if (lastRepoFingerprintRef.current === repoFingerprint) return;
    lastRepoFingerprintRef.current = repoFingerprint;
    const timer = setTimeout(() => reviewRefreshRef.current(), 300);
    return () => clearTimeout(timer);
  }, [repoFingerprint, shouldLoadDiffData, usesReview]);

  const branchBaseLabel = branchSource?.baseRef ?? null;
  const currentBranch = gitStatusQuery.data?.refName ?? activeThread?.branch ?? null;

  // Branches to compare against. Only fetch when the source dropdown could use
  // it (branch mode) so we don't list refs for turn/working-tree views.
  const shouldLoadBranchRefs = shouldLoadDiffData && source.kind === "branch";
  const vcsRefs = useVcsRefs({
    environmentId: shouldLoadBranchRefs ? (activeThread?.environmentId ?? null) : null,
    cwd: shouldLoadBranchRefs ? (activeCwd ?? null) : null,
  });
  const branchOptions = useMemo<ReadonlyArray<DiffBranchOption>>(() => {
    const refs = vcsRefs.data?.refs ?? [];
    return refs.map((ref) => ({
      name: ref.name,
      current: ref.current,
      isDefault: ref.isDefault,
      isRemote: ref.isRemote ?? false,
    }));
  }, [vcsRefs.data]);

  // Resolve the active patch + loading/error state for whichever source is active.
  const selectedPatch = usesReview
    ? source.kind === "branch"
      ? branchSource?.diff
      : workingTreeSource?.diff
    : activeCheckpointDiff.data?.diff;
  const isLoadingDiff = usesReview ? reviewDiff.isPending : activeCheckpointDiff.isPending;
  const diffError = usesReview ? reviewDiff.error : activeCheckpointDiff.error;

  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);

  const diffStats = useMemo(
    () => summarizeTurnDiffStats(adaptFileDiffsToTreeChanges(renderableFiles)),
    [renderableFiles],
  );

  const allFileKeys = useMemo(() => renderableFiles.map(buildFileDiffRenderKey), [renderableFiles]);
  const allCollapsed =
    allFileKeys.length > 0 && allFileKeys.every((fileKey) => collapsedDiffFileKeys.has(fileKey));

  const toggleCollapseAll = useCallback(() => {
    setCollapsedDiffFileKeys((current) => {
      const everyCollapsed =
        allFileKeys.length > 0 && allFileKeys.every((fileKey) => current.has(fileKey));
      return everyCollapsed ? new Set() : new Set(allFileKeys);
    });
  }, [allFileKeys]);

  const toggleFileCollapse = useCallback((fileKey: string) => {
    setCollapsedDiffFileKeys((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) {
        next.delete(fileKey);
      } else {
        next.add(fileKey);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (renderableFiles.length === 0) {
      setCollapsedDiffFileKeys((current) => (current.size === 0 ? current : new Set()));
      return;
    }

    const visibleFileKeys = new Set(renderableFiles.map(buildFileDiffRenderKey));
    setCollapsedDiffFileKeys((current) => {
      const next = new Set([...current].filter((fileKey) => visibleFileKeys.has(fileKey)));
      return next.size === current.size ? current : next;
    });
  }, [renderableFiles]);

  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffIgnoreWhitespace(settings.diffIgnoreWhitespace);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffIgnoreWhitespace]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        openInEditor: (targetPath) => {
          const api = readLocalApi();
          if (!api) return;
          void openInPreferredEditor(api, targetPath).catch((error) => {
            console.warn("Failed to open diff file in editor.", error);
          });
        },
      });
    },
    [activeCwd, routeThreadRef],
  );

  const selectSource = useCallback(
    (next: DiffSourceSelection) => {
      if (!activeThread) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          if (next.kind === "turn") {
            return { ...rest, diff: "1" as const, diffTurnId: next.turnId };
          }
          if (next.kind === "branch") {
            return {
              ...rest,
              diff: "1" as const,
              diffSource: "branch" as const,
              ...(next.baseRef ? { diffBaseRef: next.baseRef } : {}),
            };
          }
          return { ...rest, diff: "1" as const, diffSource: next.kind };
        },
      });
    },
    [activeThread, navigate],
  );
  const selectFile = useCallback(
    (filePath: string) => {
      if (!activeThread) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        // Keep the current source params; only set the focused file.
        search: (previous) => ({ ...previous, diff: "1", diffFilePath: filePath }),
      });
    },
    [activeThread, navigate],
  );

  const refreshDiff = useCallback(() => {
    if (usesReview) {
      reviewDiff.refresh();
    }
  }, [reviewDiff, usesReview]);

  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className={cn(
            "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          style={
            canScrollTurnStripLeft || canScrollTurnStripRight
              ? {
                  maskImage: `linear-gradient(to right, ${canScrollTurnStripLeft ? "transparent 24px, black 72px" : "black"}, ${canScrollTurnStripRight ? "black calc(100% - 72px), transparent calc(100% - 24px)" : "black"})`,
                }
              : undefined
          }
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary) => (
            <Tooltip key={summary.turnId}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={summary.turnId}
                    className="shrink-0 rounded-md"
                    onClick={() => selectTurn(summary.turnId)}
                    data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
                  />
                }
              >
                <div
                  className={cn(
                    "rounded-md border px-2 py-1 text-left transition-colors",
                    summary.turnId === selectedTurn?.turnId
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] leading-tight font-medium">
                      Turn{" "}
                      {summary.checkpointTurnCount ??
                        inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                        "?"}
                    </span>
                    <span className="text-[9px] leading-tight opacity-70 tabular-nums">
                      {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                    </span>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipPopup side="top">{summary.turnId}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <ToggleGroup
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[diffRenderMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              setDiffRenderMode(next);
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <Rows3Icon className="size-3" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <Columns2Icon className="size-3" />
          </Toggle>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={
                  diffWordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"
                }
                variant="outline"
                size="xs"
                pressed={diffWordWrap}
                onPressedChange={(pressed) => {
                  setDiffWordWrap(Boolean(pressed));
                }}
              />
            }
          >
            <TextWrapIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={
                  diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                }
                variant="outline"
                size="xs"
                pressed={diffIgnoreWhitespace}
                onPressedChange={(pressed) => {
                  setDiffIgnoreWhitespace(Boolean(pressed));
                }}
              />
            }
          >
            <PilcrowIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </>
  );

  const loadingLabel = usesReview ? "Loading diff..." : "Loading checkpoint diff...";

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Diffs are unavailable because this project is not a git repository.
        </div>
      ) : (
        <>
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {checkpointDiffError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-[11px] text-red-500/80">{checkpointDiffError}</p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingCheckpointDiff ? (
                <DiffPanelLoadingState label="Loading checkpoint diff..." />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {hasNoNetChanges
                      ? "No net changes in this selection."
                      : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <Virtualizer
                className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                {renderableFiles.map((fileDiff) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const fileKey = buildFileDiffRenderKey(fileDiff);
                  const themedFileKey = `${fileKey}:${resolvedTheme}`;
                  const collapsed = collapsedDiffFileKeys.has(fileKey);
                  return (
                    <div
                      key={themedFileKey}
                      data-diff-file-path={filePath}
                      className="diff-render-file group/diff-file mb-2 rounded-md first:mt-2 last:mb-0"
                      onClickCapture={(event) => {
                        const nativeEvent = event.nativeEvent as MouseEvent;
                        const composedPath = nativeEvent.composedPath?.() ?? [];
                        const clickedHeader = composedPath.some((node) => {
                          if (!(node instanceof Element)) return false;
                          return node.hasAttribute("data-title");
                        });
                        if (!clickedHeader) return;
                        openDiffFile(filePath);
                      }}
                    >
                      <FileDiff
                        fileDiff={fileDiff}
                        renderHeaderPrefix={() => (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  className={cn(
                                    "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden",
                                    getDiffCollapseIconClassName(fileDiff),
                                  )}
                                  aria-label={
                                    collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`
                                  }
                                  aria-expanded={!collapsed}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleDiffFileCollapsed(fileKey);
                                  }}
                                />
                              }
                            >
                              {collapsed ? (
                                <ChevronRightIcon className="size-4" />
                              ) : (
                                <ChevronDownIcon className="size-4" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {collapsed ? "Expand diff" : "Collapse diff"}
                            </TooltipPopup>
                          </Tooltip>
                        )}
                        options={{
                          collapsed,
                          diffStyle: diffRenderMode === "split" ? "split" : "unified",
                          lineDiffType: "none",
                          overflow: diffWordWrap ? "wrap" : "scroll",
                          theme: resolveDiffThemeName(resolvedTheme),
                          themeType: resolvedTheme as DiffThemeType,
                          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                        }}
                      />
                    </div>
                  );
                })}
              </Virtualizer>
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {hasNoNetChanges
                    ? "No changes in this selection."
                    : "No diff available for this selection."}
                </p>
              </div>
            )
          ) : (
            <DiffPanelBody
              renderablePatch={renderablePatch}
              selectedFilePath={selectedFilePath}
              diffRenderMode={diffRenderMode}
              diffWordWrap={diffWordWrap}
              collapsedFileKeys={collapsedDiffFileKeys}
              onToggleFileCollapse={toggleFileCollapse}
              resolvedTheme={resolvedTheme as DiffThemeType}
              railCollapsed={railCollapsed}
              railSize={railSize}
              onRailResize={setRailSize}
              railMinSize={minRailSize}
              railMaxSize={maxRailSize}
              onSelectFile={selectFile}
              onOpenFileInEditor={openDiffFileInEditor}
            />
          )}
        </div>
      )}
    </DiffPanelShell>
  );
}
