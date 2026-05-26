import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime";
import type { ModelSelection, PullRequestSummary } from "@t3tools/contracts";
import { DEFAULT_MODEL, DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../composerDraftStore";
import { PullRequestListPanel } from "../components/PullRequestListPanel";
import { buildPullRequestReviewPrompt } from "../components/PullRequestReviewView";
import {
  PullRequestWorkspace,
  type PullRequestWorkspaceView,
} from "../components/PullRequestWorkspace";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { ensureEnvironmentApi } from "../environmentApi";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import {
  gitPreparePullRequestThreadMutationOptions,
  gitPullRequestsQueryOptions,
} from "../lib/gitPRReactQuery";
import { readLocalApi } from "../localApi";
import { selectEnvironmentState, selectProjectsAcrossEnvironments, useStore } from "../store";
import type { Project } from "../types";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

function resolveReviewModelSelection(project: Project): ModelSelection {
  const envState = selectEnvironmentState(useStore.getState(), project.environmentId);
  const projectThreadIds = envState.threadIdsByProjectId[project.id] ?? [];

  let mostRecentSelection: ModelSelection | null = null;
  let mostRecentTimestamp = "";
  for (const threadId of projectThreadIds) {
    const shell = envState.threadShellById[threadId];
    if (!shell || shell.archivedAt !== null) continue;
    const timestamp = shell.updatedAt ?? shell.createdAt;
    if (timestamp > mostRecentTimestamp) {
      mostRecentTimestamp = timestamp;
      mostRecentSelection = shell.modelSelection;
    }
  }
  if (mostRecentSelection) {
    return mostRecentSelection;
  }

  const composerState = useComposerDraftStore.getState();
  const stickyProvider = composerState.stickyActiveProvider;
  if (stickyProvider) {
    const stickySelection = composerState.stickyModelSelectionByProvider[stickyProvider];
    if (stickySelection) {
      return stickySelection;
    }
  }

  if (project.defaultModelSelection) {
    return project.defaultModelSelection;
  }

  return {
    instanceId: "codex",
    model: DEFAULT_MODEL,
  } as ModelSelection;
}

const PR_LAST_PROJECT_KEY = "t3code:pr-last-project-id";
const PR_LAST_STATE_KEY = "t3code:pr-last-state";

const VALID_VIEWS = new Set<PullRequestWorkspaceView>(["overview", "files", "conversation"]);

export interface PullRequestsSearch {
  readonly projectId?: string | undefined;
  readonly prNumber?: number | undefined;
  readonly filePath?: string | undefined;
  readonly view?: PullRequestWorkspaceView | undefined;
}

function parsePullRequestsSearch(search: Record<string, unknown>): PullRequestsSearch {
  const rawProjectId = search.projectId;
  const projectId =
    typeof rawProjectId === "string" && rawProjectId.trim().length > 0
      ? rawProjectId.trim()
      : undefined;

  const rawPrNumber = search.prNumber;
  let prNumber: number | undefined;
  if (typeof rawPrNumber === "number" && Number.isInteger(rawPrNumber) && rawPrNumber > 0) {
    prNumber = rawPrNumber;
  } else if (typeof rawPrNumber === "string") {
    const parsed = Number.parseInt(rawPrNumber, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      prNumber = parsed;
    }
  }

  const rawFilePath = search.filePath;
  const filePath =
    typeof rawFilePath === "string" && rawFilePath.trim().length > 0
      ? rawFilePath.trim()
      : undefined;

  const rawView = search.view;
  const view =
    typeof rawView === "string" && VALID_VIEWS.has(rawView as PullRequestWorkspaceView)
      ? (rawView as PullRequestWorkspaceView)
      : undefined;

  return {
    ...(projectId !== undefined ? { projectId } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(view !== undefined ? { view } : {}),
  };
}

function PullRequestsRouteView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));

  const activeProject = useMemo(() => {
    const key =
      search.projectId ??
      (typeof window !== "undefined" ? window.localStorage.getItem(PR_LAST_PROJECT_KEY) : null);
    if (key) {
      const match = projects.find(
        (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === key,
      );
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects, search.projectId]);

  const activeProjectKey = activeProject
    ? scopedProjectKey(scopeProjectRef(activeProject.environmentId, activeProject.id))
    : null;

  useEffect(() => {
    if (activeProjectKey) {
      window.localStorage.setItem(PR_LAST_PROJECT_KEY, activeProjectKey);
    }
  }, [activeProjectKey]);

  const environmentId = activeProject?.environmentId ?? null;
  const cwd = activeProject?.cwd ?? null;
  const selectedPrNumber = search.prNumber ?? null;
  const selectedFilePath = search.filePath ?? null;
  const selectedView: PullRequestWorkspaceView = search.view ?? "overview";

  useEffect(() => {
    const state: Record<string, unknown> = {};
    if (activeProjectKey) state.projectId = activeProjectKey;
    if (selectedPrNumber !== null) state.prNumber = selectedPrNumber;
    if (selectedFilePath !== null) state.filePath = selectedFilePath;
    if (selectedView !== "overview") state.view = selectedView;
    window.localStorage.setItem(PR_LAST_STATE_KEY, JSON.stringify(state));
  }, [activeProjectKey, selectedPrNumber, selectedFilePath, selectedView]);

  const pullRequestsQuery = useQuery(gitPullRequestsQueryOptions({ environmentId, cwd }));

  const selectedPullRequest = useMemo<PullRequestSummary | null>(() => {
    if (selectedPrNumber === null || !pullRequestsQuery.data) {
      return null;
    }
    const matchesNumber = (pr: PullRequestSummary) => pr.number === selectedPrNumber;
    return (
      pullRequestsQuery.data.reviewRequested.find(matchesNumber) ??
      pullRequestsQuery.data.myPrs.find(matchesNumber) ??
      null
    );
  }, [pullRequestsQuery.data, selectedPrNumber]);

  const projectSelectItems = useMemo(
    () =>
      projects.map((project) => ({
        value: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        label: project.name,
      })),
    [projects],
  );

  const handleSelect = useCallback(
    (pr: PullRequestSummary) => {
      if (!activeProjectKey) return;
      void navigate({
        to: "/pull-requests" as string,
        search: { projectId: activeProjectKey, prNumber: pr.number, view: "overview" },
      } as any);
    },
    [activeProjectKey, navigate],
  );

  const handleClose = useCallback(() => {
    if (!activeProjectKey) return;
    void navigate({
      to: "/pull-requests" as string,
      search: { projectId: activeProjectKey },
    } as any);
  }, [activeProjectKey, navigate]);

  const handleOpenExternal = useCallback(async (url: string) => {
    try {
      const api = readLocalApi();
      if (api) {
        await api.shell.openExternal(url);
        return;
      }
    } catch {
      // fall through to window.open
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleProjectChange = useCallback(
    (nextProjectKey: string | null) => {
      if (nextProjectKey === null) return;
      void navigate({
        to: "/pull-requests" as string,
        search: { projectId: nextProjectKey },
      } as any);
    },
    [navigate],
  );

  const handleFilePathChange = useCallback(
    (filePath: string | null) => {
      if (!activeProjectKey || selectedPrNumber === null) return;
      void navigate({
        to: "/pull-requests" as string,
        search: {
          projectId: activeProjectKey,
          prNumber: selectedPrNumber,
          view: "files" as PullRequestWorkspaceView,
          ...(filePath !== null ? { filePath } : {}),
        },
        replace: true,
      } as any);
    },
    [activeProjectKey, selectedPrNumber, navigate],
  );

  const handleViewChange = useCallback(
    (view: PullRequestWorkspaceView) => {
      if (!activeProjectKey || selectedPrNumber === null) return;
      void navigate({
        to: "/pull-requests" as string,
        search: {
          projectId: activeProjectKey,
          prNumber: selectedPrNumber,
          view,
          ...(view === "files" && selectedFilePath !== null ? { filePath: selectedFilePath } : {}),
        },
        replace: true,
      } as any);
    },
    [activeProjectKey, selectedPrNumber, selectedFilePath, navigate],
  );

  // Agent review
  const [isReviewPending, setIsReviewPending] = useState(false);

  const handleReview = useCallback(async () => {
    if (!activeProject || selectedPrNumber === null) return;
    setIsReviewPending(true);
    try {
      const prompt = buildPullRequestReviewPrompt({
        prNumber: selectedPrNumber,
        title: selectedPullRequest?.title ?? null,
        headRefName: selectedPullRequest?.headRefName ?? null,
        authorLogin: selectedPullRequest?.author ?? null,
        url: selectedPullRequest?.url ?? null,
      });
      const api = ensureEnvironmentApi(activeProject.environmentId);
      const threadId = newThreadId();
      const commandId = newCommandId();
      const messageId = newMessageId();
      const createdAt = new Date().toISOString();
      const modelSelection = resolveReviewModelSelection(activeProject);
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId,
        threadId,
        message: {
          messageId,
          role: "user",
          text: prompt,
          attachments: [],
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        createdAt,
        bootstrap: {
          createThread: {
            projectId: activeProject.id,
            title: selectedPullRequest?.title ?? `PR #${selectedPrNumber}`,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
      });
    } catch (err: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to start PR review.",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setIsReviewPending(false);
    }
  }, [activeProject, selectedPrNumber, selectedPullRequest]);

  // Checkout / worktree
  const preparePrMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({ environmentId, cwd, queryClient }),
  );
  const [checkoutPending, setCheckoutPending] = useState<"local" | "worktree" | null>(null);

  const handleCheckout = useCallback(
    async (mode: "local" | "worktree") => {
      if (selectedPrNumber === null || !cwd || !environmentId) return;
      setCheckoutPending(mode);
      try {
        const result = await preparePrMutation.mutateAsync({
          reference: String(selectedPrNumber),
          mode,
        });
        toastManager.add({
          type: "success",
          title: mode === "local" ? "Branch checked out" : "Worktree created",
          description:
            mode === "local"
              ? `Switched to branch ${result.branch}`
              : `Worktree created at ${result.worktreePath ?? result.branch}`,
        });
      } catch (err) {
        toastManager.add({
          type: "error",
          title: mode === "local" ? "Checkout failed" : "Worktree creation failed",
          description: err instanceof Error ? err.message : "An error occurred.",
        });
      } finally {
        setCheckoutPending(null);
      }
    },
    [cwd, environmentId, preparePrMutation, selectedPrNumber],
  );

  const hasFileOpen = selectedFilePath !== null && selectedView === "files";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <SidebarTrigger className="size-7 shrink-0" />
          <span className="text-sm font-medium text-foreground">Pull requests</span>
          {projects.length > 0 && activeProject && activeProjectKey ? (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <Select
                value={activeProjectKey}
                onValueChange={handleProjectChange}
                items={projectSelectItems}
              >
                <SelectTrigger variant="ghost" size="xs" className="font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => {
                    const key = scopedProjectKey(
                      scopeProjectRef(project.environmentId, project.id),
                    );
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex flex-col">
                          <span className="text-xs">{project.name}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {project.cwd}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Inbox rail — hidden when a file is open in files view on narrow screens */}
          {(!hasFileOpen || selectedPrNumber === null) && (
            <div className="w-72 shrink-0 border-r border-border/70">
              <PullRequestListPanel
                environmentId={environmentId}
                cwd={cwd}
                selectedPrNumber={selectedPrNumber}
                onSelect={handleSelect}
                onOpenExternal={handleOpenExternal}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {selectedPrNumber === null ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                Select a pull request from the list to start reviewing.
              </div>
            ) : (
              <PullRequestWorkspace
                environmentId={environmentId}
                cwd={cwd}
                prNumber={selectedPrNumber}
                prSummary={selectedPullRequest}
                view={selectedView}
                onViewChange={handleViewChange}
                openFilePath={selectedFilePath}
                onFilePathChange={handleFilePathChange}
                onOpenExternal={handleOpenExternal}
                {...(activeProject
                  ? {
                      onReviewWithAgent: handleReview,
                      isAgentReviewPending: isReviewPending,
                      onCheckout: handleCheckout,
                      isCheckoutPending: checkoutPending,
                    }
                  : {})}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/pull-requests")({
  component: PullRequestsRouteView,
  validateSearch: parsePullRequestsSearch,
});
