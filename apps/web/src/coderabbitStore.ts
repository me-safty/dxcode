import type { CodeRabbitFindingId, CodeRabbitReviewScope } from "@t3tools/contracts";
import { create } from "zustand";

export type ReviewRailTab = "diff" | "review" | null;

interface FixSessionProgressEntry {
  readonly label: string;
  readonly completed: boolean;
}

interface CodeRabbitUiState {
  activeRailTab: ReviewRailTab;
  selectedScopeByCwd: Record<string, CodeRabbitReviewScope>;
  selectedBaseBranchByCwd: Record<string, string>;
  selectedFindingIdsByReviewId: Record<string, CodeRabbitFindingId[]>;
  fixProgressByReviewId: Record<string, Record<string, FixSessionProgressEntry>>;
  setActiveRailTab: (tab: ReviewRailTab) => void;
  toggleRailTab: (tab: Exclude<ReviewRailTab, null>) => void;
  setSelectedScope: (cwd: string, scope: CodeRabbitReviewScope) => void;
  setSelectedBaseBranch: (cwd: string, baseBranch: string) => void;
  setSelectedFindingIds: (reviewId: string, findingIds: CodeRabbitFindingId[]) => void;
  toggleFindingSelection: (reviewId: string, findingId: CodeRabbitFindingId) => void;
  clearFindingSelection: (reviewId: string) => void;
  startFixSession: (reviewId: string, key: string, label: string) => void;
  completeFixSession: (reviewId: string, key: string) => void;
  clearFixProgress: (reviewId: string) => void;
}

function uniqueFindingIds(findingIds: readonly CodeRabbitFindingId[]) {
  return [...new Set(findingIds)];
}

export const useCodeRabbitStore = create<CodeRabbitUiState>((set) => ({
  activeRailTab: null,
  selectedScopeByCwd: {},
  selectedBaseBranchByCwd: {},
  selectedFindingIdsByReviewId: {},
  fixProgressByReviewId: {},
  setActiveRailTab: (tab) => set({ activeRailTab: tab }),
  toggleRailTab: (tab) =>
    set((state) => ({
      activeRailTab: state.activeRailTab === tab ? null : tab,
    })),
  setSelectedScope: (cwd, scope) =>
    set((state) => ({
      selectedScopeByCwd: {
        ...state.selectedScopeByCwd,
        [cwd]: scope,
      },
    })),
  setSelectedBaseBranch: (cwd, baseBranch) =>
    set((state) => ({
      selectedBaseBranchByCwd: {
        ...state.selectedBaseBranchByCwd,
        [cwd]: baseBranch,
      },
    })),
  setSelectedFindingIds: (reviewId, findingIds) =>
    set((state) => ({
      selectedFindingIdsByReviewId: {
        ...state.selectedFindingIdsByReviewId,
        [reviewId]: uniqueFindingIds(findingIds),
      },
    })),
  toggleFindingSelection: (reviewId, findingId) =>
    set((state) => {
      const current = state.selectedFindingIdsByReviewId[reviewId] ?? [];
      const next = current.includes(findingId)
        ? current.filter((entry) => entry !== findingId)
        : [...current, findingId];
      return {
        selectedFindingIdsByReviewId: {
          ...state.selectedFindingIdsByReviewId,
          [reviewId]: next,
        },
      };
    }),
  clearFindingSelection: (reviewId) =>
    set((state) => ({
      selectedFindingIdsByReviewId: {
        ...state.selectedFindingIdsByReviewId,
        [reviewId]: [],
      },
    })),
  startFixSession: (reviewId, key, label) =>
    set((state) => ({
      fixProgressByReviewId: {
        ...state.fixProgressByReviewId,
        [reviewId]: {
          ...state.fixProgressByReviewId[reviewId],
          [key]: {
            label,
            completed: false,
          },
        },
      },
    })),
  completeFixSession: (reviewId, key) =>
    set((state) => {
      const reviewProgress = state.fixProgressByReviewId[reviewId] ?? {};
      const current = reviewProgress[key];
      if (!current) {
        return state;
      }
      return {
        fixProgressByReviewId: {
          ...state.fixProgressByReviewId,
          [reviewId]: {
            ...reviewProgress,
            [key]: {
              ...current,
              completed: true,
            },
          },
        },
      };
    }),
  clearFixProgress: (reviewId) =>
    set((state) => ({
      fixProgressByReviewId: {
        ...state.fixProgressByReviewId,
        [reviewId]: {},
      },
    })),
}));
