import {
  type CodeRabbitFindingId,
  type CodeRabbitReviewEvent,
  type CodeRabbitReviewSnapshot,
  type ThreadId,
} from "@t3tools/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCodeRabbitStore } from "~/coderabbitStore";
import { ensureNativeApi } from "~/nativeApi";
import { gitBranchSearchInfiniteQueryOptions, gitStatusQueryOptions } from "~/lib/gitReactQuery";
import {
  coderabbitCancelReviewMutationOptions,
  coderabbitFixWithAiMutationOptions,
  coderabbitQueryKeys,
  coderabbitReviewQueryOptions,
  coderabbitStartReviewMutationOptions,
  coderabbitStatusQueryOptions,
} from "~/lib/coderabbitReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";

interface CodeRabbitPanelProps {
  threadId: ThreadId;
  mode?: DiffPanelMode;
}

const EMPTY_FINDING_IDS: CodeRabbitFindingId[] = [];

function applyReviewEvent(
  current: CodeRabbitReviewSnapshot | null,
  event: CodeRabbitReviewEvent,
): CodeRabbitReviewSnapshot | null {
  switch (event.type) {
    case "snapshot":
      return event.snapshot;
    case "status_updated":
      return current
        ? {
            ...current,
            phase: event.phase,
            statusText: event.statusText,
            degraded: event.degraded ?? current.degraded,
            updatedAt: event.timestamp,
          }
        : current;
    case "finding_added":
      if (!current || current.findings.some((finding) => finding.id === event.finding.id)) {
        return current;
      }
      return {
        ...current,
        findings: [...current.findings, event.finding],
        updatedAt: event.timestamp,
      };
    case "completed":
    case "errored":
    case "cancelled":
      return event.snapshot;
  }
}

function severityBadgeVariant(
  severity: string,
): "default" | "secondary" | "outline" | "destructive" {
  switch (severity) {
    case "critical":
    case "major":
      return "destructive";
    case "minor":
      return "default";
    case "trivial":
      return "secondary";
    default:
      return "outline";
  }
}

export default function CodeRabbitPanel({ threadId, mode = "inline" }: CodeRabbitPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeThread = useStore((store) => store.threads.find((entry) => entry.id === threadId));
  const activeProject = useStore((store) =>
    activeThread ? store.projects.find((entry) => entry.id === activeThread.projectId) : undefined,
  );
  const cwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const projectId = activeProject?.id ?? null;
  const sourceThreadId =
    activeThread && activeProject && (activeThread.worktreePath ?? activeProject.cwd) === cwd
      ? activeThread.id
      : undefined;
  const activeRailTab = useCodeRabbitStore((store) => store.activeRailTab);
  const setSelectedScope = useCodeRabbitStore((store) => store.setSelectedScope);
  const setSelectedBaseBranch = useCodeRabbitStore((store) => store.setSelectedBaseBranch);
  const selectedScope = useCodeRabbitStore((store) =>
    cwd ? (store.selectedScopeByCwd[cwd] ?? "all") : "all",
  );
  const selectedBaseBranch = useCodeRabbitStore((store) =>
    cwd ? (store.selectedBaseBranchByCwd[cwd] ?? "") : "",
  );
  const selectedFindingIds = useCodeRabbitStore((store) => store.selectedFindingIdsByReviewId);
  const setSelectedFindingIds = useCodeRabbitStore((store) => store.setSelectedFindingIds);
  const toggleFindingSelection = useCodeRabbitStore((store) => store.toggleFindingSelection);
  const clearFindingSelection = useCodeRabbitStore((store) => store.clearFindingSelection);
  const startFixSession = useCodeRabbitStore((store) => store.startFixSession);
  const completeFixSession = useCodeRabbitStore((store) => store.completeFixSession);
  const clearFixProgress = useCodeRabbitStore((store) => store.clearFixProgress);
  const reviewProgress = useCodeRabbitStore((store) => store.fixProgressByReviewId);
  const statusQuery = useQuery(coderabbitStatusQueryOptions(cwd ? { cwd } : null));
  const gitStatusQuery = useQuery(gitStatusQueryOptions(cwd));
  const branchSearchQuery = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      cwd,
      query: "",
      enabled: activeRailTab === "review",
    }),
  );
  const reviewId = statusQuery.data?.activeReviewId ?? statusQuery.data?.latestReviewId ?? null;
  const reviewQuery = useQuery(coderabbitReviewQueryOptions(reviewId ? { reviewId } : null));
  const [liveSnapshot, setLiveSnapshot] = useState<CodeRabbitReviewSnapshot | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const availableBranches = useMemo(
    () =>
      branchSearchQuery.data?.pages.flatMap((page) => page.branches).map((branch) => branch.name) ??
      [],
    [branchSearchQuery.data?.pages],
  );
  const defaultBaseBranch =
    gitStatusQuery.data?.pr?.baseBranch ??
    branchSearchQuery.data?.pages
      .flatMap((page) => page.branches)
      .find((branch) => branch.isDefault)?.name ??
    "";

  useEffect(() => {
    if (!cwd || selectedBaseBranch || defaultBaseBranch.length === 0) {
      return;
    }
    setSelectedBaseBranch(cwd, defaultBaseBranch);
  }, [cwd, defaultBaseBranch, selectedBaseBranch, setSelectedBaseBranch]);

  useEffect(() => {
    if (!reviewQuery.data) {
      if (reviewId === null) {
        setLiveSnapshot(null);
      }
      return;
    }
    setLiveSnapshot(reviewQuery.data);
  }, [reviewId, reviewQuery.data]);

  useEffect(() => {
    if (reviewId) {
      clearFindingSelection(reviewId);
    }
  }, [clearFindingSelection, reviewId]);

  useEffect(() => {
    if (!reviewId || statusQuery.data?.activeReviewId !== reviewId) {
      return;
    }
    const api = ensureNativeApi();
    return api.coderabbit.onReviewEvent(
      reviewId,
      (event) => {
        setLiveSnapshot((current) => applyReviewEvent(current, event));
        if (event.type === "snapshot") {
          queryClient.setQueryData(coderabbitQueryKeys.review(reviewId), event.snapshot);
        }
        if (event.type === "completed" || event.type === "errored" || event.type === "cancelled") {
          queryClient.setQueryData(coderabbitQueryKeys.review(reviewId), event.snapshot);
          void queryClient.invalidateQueries({
            queryKey: coderabbitQueryKeys.status(cwd),
          });
        }
      },
      {
        onResubscribe: () => {
          void api.coderabbit.getReview({ reviewId }).then((snapshot) => {
            queryClient.setQueryData(coderabbitQueryKeys.review(reviewId), snapshot);
            setLiveSnapshot(snapshot);
          });
        },
      },
    );
  }, [cwd, queryClient, reviewId, statusQuery.data?.activeReviewId]);

  const activeSnapshot = liveSnapshot ?? reviewQuery.data ?? null;
  const currentSelectedFindingIds = reviewId
    ? (selectedFindingIds[reviewId] ?? EMPTY_FINDING_IDS)
    : EMPTY_FINDING_IDS;
  const currentProgress = reviewId ? Object.values(reviewProgress[reviewId] ?? {}) : [];
  const completedFixSessions = currentProgress.filter((entry) => entry.completed).length;
  const flaggedFileGroups = useMemo(() => {
    if (!activeSnapshot) {
      return [];
    }
    const groups = new Map<string, CodeRabbitFindingId[]>();
    for (const finding of activeSnapshot.findings) {
      if (finding.severity === "info") {
        continue;
      }
      const group = groups.get(finding.filePath) ?? [];
      group.push(finding.id);
      groups.set(finding.filePath, group);
    }
    return [...groups.entries()];
  }, [activeSnapshot]);

  const startReviewMutation = useMutation(
    coderabbitStartReviewMutationOptions({
      cwd,
      queryClient,
    }),
  );
  const cancelReviewMutation = useMutation(
    coderabbitCancelReviewMutationOptions({
      cwd,
      reviewId,
      queryClient,
    }),
  );
  const fixWithAiMutation = useMutation(
    coderabbitFixWithAiMutationOptions({
      reviewId,
      queryClient,
    }),
  );

  const handleStartReview = useCallback(async () => {
    if (!cwd) {
      return;
    }
    setActionError(null);
    try {
      await startReviewMutation.mutateAsync({
        cwd,
        scope: selectedScope,
        ...(selectedBaseBranch.trim().length > 0 ? { baseBranch: selectedBaseBranch.trim() } : {}),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to start CodeRabbit review.");
    }
  }, [cwd, selectedBaseBranch, selectedScope, startReviewMutation]);

  const handleCancelReview = useCallback(async () => {
    if (!reviewId) {
      return;
    }
    setActionError(null);
    try {
      await cancelReviewMutation.mutateAsync({ reviewId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to stop CodeRabbit review.");
    }
  }, [cancelReviewMutation, reviewId]);

  const runFixSession = useCallback(
    async (findingIds: CodeRabbitFindingId[], progressKey: string, label: string) => {
      if (!reviewId || !projectId) {
        return null;
      }
      startFixSession(reviewId, progressKey, label);
      const result = await fixWithAiMutation.mutateAsync({
        reviewId,
        findingIds,
        projectId,
        ...(sourceThreadId ? { sourceThreadId } : {}),
      });
      completeFixSession(reviewId, progressKey);
      return result.threadId;
    },
    [completeFixSession, fixWithAiMutation, projectId, reviewId, sourceThreadId, startFixSession],
  );

  const handleFixSelected = useCallback(async () => {
    if (currentSelectedFindingIds.length === 0) {
      return;
    }
    setActionError(null);
    try {
      const threadIdResult = await runFixSession(
        currentSelectedFindingIds,
        `selected:${currentSelectedFindingIds.join(",")}`,
        "Selected findings",
      );
      if (threadIdResult) {
        clearFindingSelection(reviewId ?? "");
        await navigate({
          to: "/$threadId",
          params: { threadId: threadIdResult },
        });
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to start the fix session.");
    }
  }, [clearFindingSelection, currentSelectedFindingIds, navigate, reviewId, runFixSession]);

  const handleFixFlaggedFiles = useCallback(async () => {
    if (!reviewId) {
      return;
    }
    setActionError(null);
    clearFixProgress(reviewId);
    try {
      for (const [filePath, findingIds] of flaggedFileGroups) {
        await runFixSession(findingIds, `file:${filePath}`, filePath);
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to start the bulk fix sessions.",
      );
    }
  }, [clearFixProgress, flaggedFileGroups, reviewId, runFixSession]);

  const handleFixSingleFinding = useCallback(
    async (findingId: CodeRabbitFindingId, filePath: string) => {
      setActionError(null);
      try {
        const threadIdResult = await runFixSession([findingId], `finding:${findingId}`, filePath);
        if (threadIdResult) {
          await navigate({
            to: "/$threadId",
            params: { threadId: threadIdResult },
          });
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Failed to start the fix session.");
      }
    },
    [navigate, runFixSession],
  );

  const canStartReview =
    cwd !== null && statusQuery.data?.available && statusQuery.data?.authenticated;
  const findings = activeSnapshot?.findings ?? [];
  const allFindingIds = findings.map((finding) => finding.id);
  const allSelected =
    allFindingIds.length > 0 && currentSelectedFindingIds.length === allFindingIds.length;
  const someSelected = currentSelectedFindingIds.length > 0 && !allSelected;

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">CodeRabbit Review</p>
        <p className="truncate text-xs text-muted-foreground">
          {cwd ?? "Open a project-backed thread to run reviews."}
        </p>
      </div>
      {activeSnapshot ? <Badge variant="outline">{activeSnapshot.phase}</Badge> : null}
    </div>
  );

  if (statusQuery.isLoading && activeRailTab === "review") {
    return (
      <DiffPanelShell mode={mode} header={header}>
        <DiffPanelLoadingState label="Loading CodeRabbit review..." />
      </DiffPanelShell>
    );
  }

  return (
    <DiffPanelShell mode={mode} header={header}>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <section className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">Scope</label>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={selectedScope}
                onChange={(event) => {
                  if (cwd) {
                    setSelectedScope(cwd, event.target.value as typeof selectedScope);
                  }
                }}
                disabled={!cwd || startReviewMutation.isPending}
              >
                <option value="all">All</option>
                <option value="committed">Committed</option>
                <option value="uncommitted">Uncommitted</option>
              </select>
              <label className="text-xs font-medium text-muted-foreground">Base branch</label>
              <div className="min-w-[12rem] flex-1">
                <Input
                  value={selectedBaseBranch}
                  onChange={(event) => {
                    if (cwd) {
                      setSelectedBaseBranch(cwd, event.target.value);
                    }
                  }}
                  list={cwd ? `coderabbit-base-branches-${threadId}` : undefined}
                  placeholder={defaultBaseBranch || "main"}
                  disabled={!cwd || startReviewMutation.isPending}
                  nativeInput
                />
                {cwd ? (
                  <datalist id={`coderabbit-base-branches-${threadId}`}>
                    {availableBranches.map((branch) => (
                      <option key={branch} value={branch} />
                    ))}
                  </datalist>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void handleStartReview();
                }}
                disabled={!canStartReview || startReviewMutation.isPending}
              >
                {startReviewMutation.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RefreshCwIcon />
                )}
                {activeSnapshot ? "Run again" : "Start review"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void handleCancelReview();
                }}
                disabled={!statusQuery.data?.activeReviewId || cancelReviewMutation.isPending}
              >
                <SquareIcon />
                Stop review
              </Button>
            </div>

            {!statusQuery.data?.available ? (
              <p className="text-sm text-muted-foreground">
                CodeRabbit CLI is unavailable. Install `coderabbit` locally to use this panel.
              </p>
            ) : null}
            {statusQuery.data?.available && !statusQuery.data.authenticated ? (
              <p className="text-sm text-muted-foreground">
                CodeRabbit is not signed in. Run `coderabbit auth login --agent` in a terminal, then
                retry.
              </p>
            ) : null}
            {actionError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive-foreground">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{actionError}</span>
              </div>
            ) : null}
            {reviewQuery.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/70 p-2 text-sm text-muted-foreground">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  Review state could not be recovered. This can happen after a server restart. Start
                  a new review to continue.
                </span>
              </div>
            ) : null}
          </section>

          {activeSnapshot ? (
            <section className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{activeSnapshot.scope}</Badge>
                <Badge variant="outline">{findings.length} findings</Badge>
                {activeSnapshot.degraded ? (
                  <Badge variant="secondary">Partial results</Badge>
                ) : null}
                {activeSnapshot.statusText ? (
                  <span className="text-xs text-muted-foreground">{activeSnapshot.statusText}</span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={(checked) => {
                    if (!reviewId) {
                      return;
                    }
                    setSelectedFindingIds(reviewId, checked ? allFindingIds : []);
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {currentSelectedFindingIds.length} selected
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentSelectedFindingIds.length === 0 || fixWithAiMutation.isPending}
                  onClick={() => {
                    void handleFixSelected();
                  }}
                >
                  <SparklesIcon />
                  Fix selected findings
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flaggedFileGroups.length === 0 || fixWithAiMutation.isPending}
                  onClick={() => {
                    void handleFixFlaggedFiles();
                  }}
                >
                  <SparklesIcon />
                  Fix flagged files
                </Button>
              </div>

              {currentProgress.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {completedFixSessions} of {currentProgress.length} fix sessions completed
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            {findings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                {activeSnapshot
                  ? "No findings yet. Run a review or wait for the current run to finish."
                  : "Run a CodeRabbit review to see findings here."}
              </div>
            ) : null}

            {findings.map((finding) => {
              const selected = currentSelectedFindingIds.includes(finding.id);
              return (
                <article
                  key={finding.id}
                  className={cn(
                    "space-y-2 rounded-xl border p-3",
                    selected ? "border-primary/50 bg-primary/5" : "border-border/70 bg-card/60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => {
                        if (reviewId) {
                          toggleFindingSelection(reviewId, finding.id);
                        }
                      }}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityBadgeVariant(finding.severity)}>
                          {finding.severity}
                        </Badge>
                        <span className="truncate text-sm font-medium text-foreground">
                          {finding.summary}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{finding.filePath}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fixWithAiMutation.isPending}
                      onClick={() => {
                        void handleFixSingleFinding(finding.id, finding.filePath);
                      }}
                    >
                      <SparklesIcon />
                      Fix with AI
                    </Button>
                  </div>
                  <div className="rounded-lg bg-background/80 p-3 text-sm leading-6 whitespace-pre-wrap text-foreground/90">
                    {finding.codegenInstructions}
                  </div>
                  {finding.suggestions.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
                      {finding.suggestions.map((suggestion) => (
                        <p key={suggestion} className="text-sm text-muted-foreground">
                          {suggestion}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        </div>
      </ScrollArea>
    </DiffPanelShell>
  );
}
