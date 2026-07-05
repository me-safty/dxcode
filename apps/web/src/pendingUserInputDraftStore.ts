import type { ApprovalRequestId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, type DebouncedStorage } from "./lib/storage";
import type { PendingUserInputDraftAnswer } from "./pendingUserInput";

export const PENDING_USER_INPUT_DRAFT_STORAGE_KEY = "t3code:pending-user-input-drafts:v1";

const noopPendingUserInputStorage: DebouncedStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  flush: () => {},
};

function createPendingUserInputStorage(): DebouncedStorage {
  if (typeof window === "undefined") {
    return noopPendingUserInputStorage;
  }
  try {
    return createDebouncedStorage(window.localStorage);
  } catch {
    return noopPendingUserInputStorage;
  }
}

const pendingUserInputDebouncedStorage = createPendingUserInputStorage();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    pendingUserInputDebouncedStorage.flush();
  });
}

interface PendingUserInputThreadDraftState {
  answersByRequestId: Record<ApprovalRequestId, Record<string, PendingUserInputDraftAnswer>>;
  questionIndexByRequestId: Record<ApprovalRequestId, number>;
}

interface PendingUserInputDraftStoreState {
  draftsByThreadId: Record<ThreadId, PendingUserInputThreadDraftState>;
  setQuestionIndex: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    questionIndex: number,
  ) => void;
  setAnswer: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    questionId: string,
    answer: PendingUserInputDraftAnswer,
  ) => void;
  clearInactiveRequests: (
    threadId: ThreadId,
    activeRequestIds: ReadonlyArray<ApprovalRequestId>,
  ) => void;
}

const EMPTY_PENDING_USER_INPUT_THREAD_DRAFT = Object.freeze({
  answersByRequestId: {},
  questionIndexByRequestId: {},
}) as PendingUserInputThreadDraftState;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePersistedDraftAnswer(value: unknown): PendingUserInputDraftAnswer | null {
  if (!isRecord(value)) {
    return null;
  }
  const answerSource =
    value.answerSource === "option" || value.answerSource === "custom"
      ? value.answerSource
      : undefined;
  const selectedOptionLabels = Array.isArray(value.selectedOptionLabels)
    ? Array.from(
        new Set(
          value.selectedOptionLabels
            .filter((label): label is string => typeof label === "string")
            .map((label) => label.trim())
            .filter((label) => label.length > 0),
        ),
      )
    : [];
  const customAnswer = typeof value.customAnswer === "string" ? value.customAnswer : undefined;
  const normalized: PendingUserInputDraftAnswer = {
    ...(answerSource ? { answerSource } : {}),
    ...(answerSource !== "option" && customAnswer !== undefined ? { customAnswer } : {}),
    ...(answerSource !== "custom" && selectedOptionLabels.length > 0
      ? { selectedOptionLabels }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeAnswersByRequestId(
  value: unknown,
): PendingUserInputThreadDraftState["answersByRequestId"] {
  if (!isRecord(value)) {
    return {};
  }
  const answersByRequestId: PendingUserInputThreadDraftState["answersByRequestId"] = {};
  for (const [requestId, answersByQuestionId] of Object.entries(value)) {
    if (!isRecord(answersByQuestionId)) {
      continue;
    }
    const normalizedAnswers: Record<string, PendingUserInputDraftAnswer> = {};
    for (const [questionId, answer] of Object.entries(answersByQuestionId)) {
      const normalizedAnswer = normalizePersistedDraftAnswer(answer);
      if (normalizedAnswer) {
        normalizedAnswers[questionId] = normalizedAnswer;
      }
    }
    if (Object.keys(normalizedAnswers).length > 0) {
      answersByRequestId[requestId as ApprovalRequestId] = normalizedAnswers;
    }
  }
  return answersByRequestId;
}

function normalizeThreadDraft(value: unknown): PendingUserInputThreadDraftState {
  if (!isRecord(value)) {
    return EMPTY_PENDING_USER_INPUT_THREAD_DRAFT;
  }
  const answersByRequestId = normalizeAnswersByRequestId(value.answersByRequestId);
  const questionIndexByRequestId = Object.fromEntries(
    Object.entries(isRecord(value.questionIndexByRequestId) ? value.questionIndexByRequestId : {})
      .filter(
        ([, questionIndex]) => typeof questionIndex === "number" && Number.isFinite(questionIndex),
      )
      .map(([requestId, questionIndex]) => {
        const safeQuestionIndex = questionIndex as number;
        return [requestId, Math.max(0, Math.floor(safeQuestionIndex))];
      }),
  ) as PendingUserInputThreadDraftState["questionIndexByRequestId"];
  return { answersByRequestId, questionIndexByRequestId };
}

function mergeThreadDrafts(
  persistedDraft: PendingUserInputThreadDraftState | undefined,
  currentDraft: PendingUserInputThreadDraftState | undefined,
): PendingUserInputThreadDraftState {
  return {
    answersByRequestId: {
      ...persistedDraft?.answersByRequestId,
      ...currentDraft?.answersByRequestId,
    },
    questionIndexByRequestId: {
      ...persistedDraft?.questionIndexByRequestId,
      ...currentDraft?.questionIndexByRequestId,
    },
  };
}

function mergePersistedPendingUserInputDrafts(
  persistedState: unknown,
  currentState: PendingUserInputDraftStoreState,
): PendingUserInputDraftStoreState {
  if (!isRecord(persistedState) || !isRecord(persistedState.draftsByThreadId)) {
    return currentState;
  }
  const persistedDraftsByThreadId = Object.fromEntries(
    Object.entries(persistedState.draftsByThreadId)
      .map(([threadId, draft]) => [threadId, normalizeThreadDraft(draft)] as const)
      .filter(([, draft]) => !shouldRemoveThreadDraft(draft)),
  ) as Record<ThreadId, PendingUserInputThreadDraftState>;
  const threadIds = new Set([
    ...Object.keys(persistedDraftsByThreadId),
    ...Object.keys(currentState.draftsByThreadId),
  ]);
  const draftsByThreadId = Object.fromEntries(
    Array.from(threadIds)
      .map(
        (threadId) =>
          [
            threadId,
            mergeThreadDrafts(
              persistedDraftsByThreadId[threadId as ThreadId],
              currentState.draftsByThreadId[threadId as ThreadId],
            ),
          ] as const,
      )
      .filter(([, draft]) => !shouldRemoveThreadDraft(draft)),
  ) as Record<ThreadId, PendingUserInputThreadDraftState>;
  return { ...currentState, draftsByThreadId };
}

function shouldRemoveThreadDraft(draft: PendingUserInputThreadDraftState | undefined): boolean {
  if (!draft) {
    return true;
  }
  return (
    Object.keys(draft.answersByRequestId).length === 0 &&
    Object.keys(draft.questionIndexByRequestId).length === 0
  );
}

export const usePendingUserInputDraftStore = create<PendingUserInputDraftStoreState>()(
  persist(
    (set) => ({
      draftsByThreadId: {},
      setQuestionIndex: (threadId, requestId, questionIndex) => {
        if (threadId.length === 0 || requestId.length === 0) {
          return;
        }
        set((state) => {
          const threadDraft =
            state.draftsByThreadId[threadId] ?? EMPTY_PENDING_USER_INPUT_THREAD_DRAFT;
          const nextQuestionIndex = Math.max(0, Math.floor(questionIndex));
          if (threadDraft.questionIndexByRequestId[requestId] === nextQuestionIndex) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                answersByRequestId: threadDraft.answersByRequestId,
                questionIndexByRequestId: {
                  ...threadDraft.questionIndexByRequestId,
                  [requestId]: nextQuestionIndex,
                },
              },
            },
          };
        });
      },
      setAnswer: (threadId, requestId, questionId, answer) => {
        if (threadId.length === 0 || requestId.length === 0 || questionId.length === 0) {
          return;
        }
        set((state) => {
          const threadDraft =
            state.draftsByThreadId[threadId] ?? EMPTY_PENDING_USER_INPUT_THREAD_DRAFT;
          const requestAnswers = threadDraft.answersByRequestId[requestId] ?? {};
          const currentAnswer = requestAnswers[questionId];
          const prevLabels = currentAnswer?.selectedOptionLabels;
          const nextLabels = answer.selectedOptionLabels;
          const labelsEqual =
            prevLabels === nextLabels ||
            (prevLabels != null &&
              nextLabels != null &&
              prevLabels.length === nextLabels.length &&
              prevLabels.every((l, i) => l === nextLabels[i]));
          if (
            currentAnswer?.answerSource === answer.answerSource &&
            currentAnswer?.customAnswer === answer.customAnswer &&
            labelsEqual
          ) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                answersByRequestId: {
                  ...threadDraft.answersByRequestId,
                  [requestId]: {
                    ...requestAnswers,
                    [questionId]: answer,
                  },
                },
                questionIndexByRequestId: threadDraft.questionIndexByRequestId,
              },
            },
          };
        });
      },
      clearInactiveRequests: (threadId, activeRequestIds) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const threadDraft = state.draftsByThreadId[threadId];
          if (!threadDraft) {
            return state;
          }
          const activeRequestIdSet = new Set(activeRequestIds);
          let answersChanged = false;
          const nextAnswersByRequestId = Object.fromEntries(
            Object.entries(threadDraft.answersByRequestId).filter(([requestId]) => {
              const keep = activeRequestIdSet.has(requestId as ApprovalRequestId);
              answersChanged ||= !keep;
              return keep;
            }),
          ) as PendingUserInputThreadDraftState["answersByRequestId"];
          let indexChanged = false;
          const nextQuestionIndexByRequestId = Object.fromEntries(
            Object.entries(threadDraft.questionIndexByRequestId).filter(([requestId]) => {
              const keep = activeRequestIdSet.has(requestId as ApprovalRequestId);
              indexChanged ||= !keep;
              return keep;
            }),
          ) as PendingUserInputThreadDraftState["questionIndexByRequestId"];
          if (!answersChanged && !indexChanged) {
            return state;
          }
          const nextThreadDraft: PendingUserInputThreadDraftState = {
            answersByRequestId: nextAnswersByRequestId,
            questionIndexByRequestId: nextQuestionIndexByRequestId,
          };
          if (shouldRemoveThreadDraft(nextThreadDraft)) {
            const { [threadId]: _removed, ...restDraftsByThreadId } = state.draftsByThreadId;
            return { draftsByThreadId: restDraftsByThreadId };
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: nextThreadDraft,
            },
          };
        });
      },
    }),
    {
      name: PENDING_USER_INPUT_DRAFT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => pendingUserInputDebouncedStorage),
      partialize: (state) => ({
        draftsByThreadId: Object.fromEntries(
          Object.entries(state.draftsByThreadId).filter(
            ([, draft]) => !shouldRemoveThreadDraft(draft),
          ),
        ) as Record<ThreadId, PendingUserInputThreadDraftState>,
      }),
      merge: mergePersistedPendingUserInputDrafts,
    },
  ),
);

export function usePendingUserInputThreadDraft(
  threadId: ThreadId,
): PendingUserInputThreadDraftState {
  return usePendingUserInputDraftStore(
    (state) => state.draftsByThreadId[threadId] ?? EMPTY_PENDING_USER_INPUT_THREAD_DRAFT,
  );
}
