import {
  type EnvironmentId,
  type PullRequestMergeMethod,
  type PullRequestReviewEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "../environmentApi";

const gitRefsQueryKey = (environmentId: EnvironmentId | null, cwd: string | null) =>
  ["git", "refs", environmentId ?? null, cwd] as const;

export const gitMutationKeys = {
  init: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "init", environmentId ?? null, cwd] as const,
  switchRef: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "switchRef", environmentId ?? null, cwd] as const,
  runStackedAction: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "run-stacked-action", environmentId ?? null, cwd] as const,
  pull: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "pull", environmentId ?? null, cwd] as const,
  preparePullRequestThread: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "prepare-pull-request-thread", environmentId ?? null, cwd] as const,
  publishRepository: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["git", "mutation", "publish-repository", environmentId ?? null, cwd] as const,
};

export function invalidateGitQueries(
  queryClient: QueryClient,
  input?: { environmentId?: EnvironmentId | null; cwd?: string | null },
) {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;
  if (cwd !== null) {
    return queryClient.invalidateQueries({ queryKey: gitRefsQueryKey(environmentId, cwd) });
  }

  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all });
}

const GIT_STATUS_STALE_TIME_MS = 5_000;
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000;
const GIT_PR_LIST_STALE_TIME_MS = 20_000;
const GIT_PR_LIST_REFETCH_INTERVAL_MS = 60_000;
const GIT_PR_DIFF_STALE_TIME_MS = 60_000;
const GIT_PR_COMMENTS_STALE_TIME_MS = 15_000;
const GIT_PR_COMMENTS_REFETCH_INTERVAL_MS = 60_000;
const GIT_PR_BODY_STALE_TIME_MS = 60_000;
const GIT_PR_VIEWED_FILES_STALE_TIME_MS = 30_000;
const GIT_PR_DETAIL_STALE_TIME_MS = 30_000;
const GIT_PR_DETAIL_REFETCH_INTERVAL_MS = 60_000;

export const gitQueryKeys = {
  all: ["git"] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  pullRequests: (cwd: string | null) => ["git", "pull-requests", cwd] as const,
  pullRequestDiff: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "diff", cwd, prNumber] as const,
  pullRequestFileDiff: (cwd: string | null, prNumber: number | null, filePath: string | null) =>
    ["git", "pull-request", "file-diff", cwd, prNumber, filePath] as const,
  pullRequestReviewComments: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "review-comments", cwd, prNumber] as const,
  pullRequestIssueComments: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "issue-comments", cwd, prNumber] as const,
  pullRequestBody: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "body", cwd, prNumber] as const,
  pullRequestViewedFiles: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "viewed-files", cwd, prNumber] as const,
  pullRequestDetail: (cwd: string | null, prNumber: number | null) =>
    ["git", "pull-request", "detail", cwd, prNumber] as const,
};

export const gitPRMutationKeys = {
  postReviewComment: (cwd: string | null, prNumber: number | null) =>
    ["git", "mutation", "post-review-comment", cwd, prNumber] as const,
  postIssueComment: (cwd: string | null, prNumber: number | null) =>
    ["git", "mutation", "post-issue-comment", cwd, prNumber] as const,
};

export function invalidateGitStatusQuery(queryClient: QueryClient, cwd: string | null) {
  if (cwd === null) return Promise.resolve();
  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.status(cwd) });
}

export function invalidatePullRequestComments(
  queryClient: QueryClient,
  cwd: string | null,
  prNumber: number | null,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.pullRequestReviewComments(cwd, prNumber),
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.pullRequestIssueComments(cwd, prNumber),
    }),
  ]);
}

export function gitStatusQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.status(input.cwd),
    queryFn: async () => {
      if (!input.cwd) throw new Error("Git status is unavailable.");
      if (!input.environmentId) throw new Error("Git status is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.vcs.refreshStatus({ cwd: input.cwd });
    },
    enabled: input.cwd !== null && input.environmentId !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function gitPullRequestsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequests(input.cwd),
    queryFn: async () => {
      if (!input.cwd) throw new Error("Pull request list is unavailable.");
      if (!input.environmentId) throw new Error("Pull request list is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.listPullRequests({ cwd: input.cwd });
    },
    enabled: input.cwd !== null && input.environmentId !== null,
    staleTime: GIT_PR_LIST_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_PR_LIST_REFETCH_INTERVAL_MS,
  });
}

export function gitPullRequestDiffQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestDiff(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request diff is unavailable.");
      if (!input.environmentId) throw new Error("Pull request diff is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestDiff({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_DIFF_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitPullRequestFileDiffQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  filePath: string | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestFileDiff(input.cwd, input.prNumber, input.filePath),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null || !input.filePath)
        throw new Error("Pull request file diff is unavailable.");
      if (!input.environmentId) throw new Error("Pull request file diff is unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestFileDiff({
        cwd: input.cwd,
        prNumber: input.prNumber,
        filePath: input.filePath,
      });
    },
    enabled:
      input.cwd !== null &&
      input.prNumber !== null &&
      input.filePath !== null &&
      input.environmentId !== null,
    staleTime: GIT_PR_DIFF_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitPullRequestReviewCommentsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestReviewComments(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request review comments unavailable.");
      if (!input.environmentId) throw new Error("Pull request review comments unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestReviewComments({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_COMMENTS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_PR_COMMENTS_REFETCH_INTERVAL_MS,
  });
}

export function gitPullRequestIssueCommentsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestIssueComments(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request issue comments unavailable.");
      if (!input.environmentId) throw new Error("Pull request issue comments unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestIssueComments({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_COMMENTS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_PR_COMMENTS_REFETCH_INTERVAL_MS,
  });
}

export function gitPullRequestBodyQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestBody(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null) throw new Error("Pull request body unavailable.");
      if (!input.environmentId) throw new Error("Pull request body unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestBody({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_BODY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitPullRequestViewedFilesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestViewedFiles(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request viewed files unavailable.");
      if (!input.environmentId) throw new Error("Pull request viewed files unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestViewedFiles({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_VIEWED_FILES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function gitSetPullRequestFileViewedMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return mutationOptions({
    mutationFn: async (payload: { path: string; viewed: boolean }) => {
      if (!input.cwd || input.prNumber === null || !input.environmentId)
        throw new Error("Cannot sync viewed state: missing context.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.setPullRequestFileViewed({
        cwd: input.cwd,
        prNumber: input.prNumber,
        path: payload.path,
        viewed: payload.viewed,
      });
    },
  });
}

export function gitPostPullRequestReviewCommentMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitPRMutationKeys.postReviewComment(input.cwd, input.prNumber),
    mutationFn: async (payload: { body: string; path: string; line: number }) => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request review comment unavailable.");
      if (!input.environmentId) throw new Error("Pull request review comment unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.postPullRequestComment({
        cwd: input.cwd,
        prNumber: input.prNumber,
        body: payload.body,
        path: payload.path,
        line: payload.line,
      });
    },
    onSuccess: async () => {
      await invalidatePullRequestComments(input.queryClient, input.cwd, input.prNumber);
    },
  });
}

export function gitPostPullRequestIssueCommentMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitPRMutationKeys.postIssueComment(input.cwd, input.prNumber),
    mutationFn: async (payload: { body: string }) => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request issue comment unavailable.");
      if (!input.environmentId) throw new Error("Pull request issue comment unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.postPullRequestIssueComment({
        cwd: input.cwd,
        prNumber: input.prNumber,
        body: payload.body,
      });
    },
    onSuccess: async () => {
      await invalidatePullRequestComments(input.queryClient, input.cwd, input.prNumber);
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: gitMutationKeys.preparePullRequestThread(input.environmentId, input.cwd),
    mutationFn: async (args: {
      reference: string;
      mode: "local" | "worktree";
      threadId?: ThreadId;
    }) => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Pull request thread preparation is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.preparePullRequestThread({
        cwd: input.cwd,
        reference: args.reference,
        mode: args.mode,
        ...(args.threadId ? { threadId: args.threadId } : {}),
      });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, {
        environmentId: input.environmentId,
        cwd: input.cwd,
      });
    },
  });
}

export function gitPullRequestDetailQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.pullRequestDetail(input.cwd, input.prNumber),
    queryFn: async () => {
      if (!input.cwd || input.prNumber === null)
        throw new Error("Pull request detail unavailable.");
      if (!input.environmentId) throw new Error("Pull request detail unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.getPullRequestDetail({ cwd: input.cwd, prNumber: input.prNumber });
    },
    enabled: input.cwd !== null && input.prNumber !== null && input.environmentId !== null,
    staleTime: GIT_PR_DETAIL_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_PR_DETAIL_REFETCH_INTERVAL_MS,
  });
}

export function gitSubmitPullRequestReviewMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationFn: async (payload: { event: PullRequestReviewEvent; body?: string }) => {
      if (!input.cwd || input.prNumber === null || !input.environmentId)
        throw new Error("Submit review unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.submitPullRequestReview({
        cwd: input.cwd,
        prNumber: input.prNumber,
        event: payload.event,
        ...(payload.body ? { body: payload.body } : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        invalidatePullRequestComments(input.queryClient, input.cwd, input.prNumber),
        input.queryClient.invalidateQueries({
          queryKey: gitQueryKeys.pullRequestDetail(input.cwd, input.prNumber),
        }),
        input.queryClient.invalidateQueries({
          queryKey: gitQueryKeys.pullRequests(input.cwd),
        }),
      ]);
    },
  });
}

export function gitMergePullRequestMutationOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationFn: async (payload: { method: PullRequestMergeMethod; deleteBranch?: boolean }) => {
      if (!input.cwd || input.prNumber === null || !input.environmentId)
        throw new Error("Merge unavailable.");
      const api = ensureEnvironmentApi(input.environmentId);
      return api.git.mergePullRequest({
        cwd: input.cwd,
        prNumber: input.prNumber,
        method: payload.method,
        ...(payload.deleteBranch !== undefined ? { deleteBranch: payload.deleteBranch } : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        input.queryClient.invalidateQueries({
          queryKey: gitQueryKeys.pullRequestDetail(input.cwd, input.prNumber),
        }),
        input.queryClient.invalidateQueries({
          queryKey: gitQueryKeys.pullRequests(input.cwd),
        }),
      ]);
    },
  });
}

export function invalidateAllPullRequestData(
  queryClient: QueryClient,
  cwd: string | null,
  prNumber: number | null,
) {
  return Promise.all([
    invalidatePullRequestComments(queryClient, cwd, prNumber),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.pullRequestDetail(cwd, prNumber),
    }),
    queryClient.invalidateQueries({
      queryKey: gitQueryKeys.pullRequests(cwd),
    }),
  ]);
}
