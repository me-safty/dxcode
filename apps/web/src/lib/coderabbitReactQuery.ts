import type {
  CodeRabbitCancelReviewInput,
  CodeRabbitFixWithAiInput,
  CodeRabbitGetReviewInput,
  CodeRabbitGetStatusInput,
  CodeRabbitStartReviewInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

const CODERABBIT_STATUS_STALE_TIME_MS = 5_000;
const CODERABBIT_REVIEW_STALE_TIME_MS = 15_000;

export const coderabbitQueryKeys = {
  all: ["coderabbit"] as const,
  status: (cwd: string | null) => ["coderabbit", "status", cwd] as const,
  review: (reviewId: string | null) => ["coderabbit", "review", reviewId] as const,
};

export const coderabbitMutationKeys = {
  startReview: (cwd: string | null) => ["coderabbit", "mutation", "start-review", cwd] as const,
  cancelReview: (reviewId: string | null) =>
    ["coderabbit", "mutation", "cancel-review", reviewId] as const,
  fixWithAI: (reviewId: string | null) =>
    ["coderabbit", "mutation", "fix-with-ai", reviewId] as const,
};

export function invalidateCodeRabbitQueries(
  queryClient: QueryClient,
  input?: {
    cwd?: string | null;
    reviewId?: string | null;
  },
) {
  const tasks: Array<Promise<unknown>> = [];
  if (input?.cwd !== undefined) {
    tasks.push(queryClient.invalidateQueries({ queryKey: coderabbitQueryKeys.status(input.cwd) }));
  }
  if (input?.reviewId !== undefined) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: coderabbitQueryKeys.review(input.reviewId) }),
    );
  }
  if (tasks.length === 0) {
    tasks.push(queryClient.invalidateQueries({ queryKey: coderabbitQueryKeys.all }));
  }
  return Promise.all(tasks);
}

export function coderabbitStatusQueryOptions(input: CodeRabbitGetStatusInput | null) {
  return queryOptions({
    queryKey: coderabbitQueryKeys.status(input?.cwd ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input) {
        throw new Error("CodeRabbit status is unavailable.");
      }
      return api.coderabbit.getStatus(input);
    },
    enabled: input !== null,
    staleTime: CODERABBIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}

export function coderabbitReviewQueryOptions(input: CodeRabbitGetReviewInput | null) {
  return queryOptions({
    queryKey: coderabbitQueryKeys.review(input?.reviewId ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input) {
        throw new Error("CodeRabbit review is unavailable.");
      }
      return api.coderabbit.getReview(input);
    },
    enabled: input !== null,
    staleTime: CODERABBIT_REVIEW_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function coderabbitStartReviewMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: coderabbitMutationKeys.startReview(input.cwd),
    mutationFn: async (payload: CodeRabbitStartReviewInput) => {
      const api = ensureNativeApi();
      return api.coderabbit.startReview(payload);
    },
    onSettled: async (_result, _error, payload) => {
      await invalidateCodeRabbitQueries(input.queryClient, {
        cwd: payload.cwd,
      });
    },
  });
}

export function coderabbitCancelReviewMutationOptions(input: {
  cwd: string | null;
  reviewId: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: coderabbitMutationKeys.cancelReview(input.reviewId),
    mutationFn: async (payload: CodeRabbitCancelReviewInput) => {
      const api = ensureNativeApi();
      return api.coderabbit.cancelReview(payload);
    },
    onSettled: async (_result, _error, payload) => {
      await invalidateCodeRabbitQueries(input.queryClient, {
        cwd: input.cwd,
        reviewId: payload.reviewId,
      });
    },
  });
}

export function coderabbitFixWithAiMutationOptions(input: {
  reviewId: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: coderabbitMutationKeys.fixWithAI(input.reviewId),
    mutationFn: async (payload: CodeRabbitFixWithAiInput) => {
      const api = ensureNativeApi();
      return api.coderabbit.fixWithAI(payload);
    },
    onSettled: async (_result, _error, payload) => {
      await invalidateCodeRabbitQueries(input.queryClient, {
        reviewId: payload.reviewId,
      });
    },
  });
}
