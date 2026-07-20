import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "commit"; sha: string }
  | {
      kind: "working-tree";
      file: { area: "staged" | "unstaged"; path: string } | null;
    }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

export type DiffPanelTab = "diff" | "review-stack";
type DiffPanelTabsByView = Record<string, DiffPanelTab>;

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "working-tree", file: null };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  selectedTabsByThreadKey: Record<string, DiffPanelTabsByView>;
  selectTab: (ref: ScopedThreadRef, selection: DiffPanelSelection, tab: DiffPanelTab) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: "branch" | "unstaged") => void;
  selectWorkingTreeFile: (ref: ScopedThreadRef, area: "staged" | "unstaged", path: string) => void;
  selectWorkingTreeAll: (ref: ScopedThreadRef) => void;
  transferWorkingTreeFileToStaged: (ref: ScopedThreadRef, path: string) => void;
  transferWorkingTreeFileToUnstaged: (ref: ScopedThreadRef, path: string) => void;
  reconcileWorkingTreeSelection: (
    ref: ScopedThreadRef,
    stagedPaths: ReadonlyArray<string>,
    unstagedPaths: ReadonlyArray<string>,
  ) => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectCommit: (ref: ScopedThreadRef, sha: string) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      selectedTabsByThreadKey: {},
      selectTab: (ref, selection, tab) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          return {
            selectedTabsByThreadKey: {
              ...state.selectedTabsByThreadKey,
              [threadKey]: {
                ...state.selectedTabsByThreadKey[threadKey],
                [diffPanelViewKey(selection)]: tab,
              },
            },
          };
        }),
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "working-tree", file: null },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectWorkingTreeFile: (ref, area, path) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: { kind: "working-tree", file: { area, path } },
          },
        })),
      selectWorkingTreeAll: (ref) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: { kind: "working-tree", file: null },
          },
        })),
      transferWorkingTreeFileToStaged: (ref, path) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          if (
            previous?.kind !== "working-tree" ||
            previous.file?.area !== "unstaged" ||
            previous.file.path !== path
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "working-tree", file: { area: "staged", path } },
            },
          };
        }),
      transferWorkingTreeFileToUnstaged: (ref, path) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          if (
            previous?.kind !== "working-tree" ||
            previous.file?.area !== "staged" ||
            previous.file.path !== path
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "working-tree", file: { area: "unstaged", path } },
            },
          };
        }),
      reconcileWorkingTreeSelection: (ref, stagedPaths, unstagedPaths) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          if (previous?.kind !== "working-tree" || previous.file === null) return state;
          const paths = previous.file.area === "staged" ? stagedPaths : unstagedPaths;
          if (paths.includes(previous.file.path)) return state;
          const oppositePaths = previous.file.area === "staged" ? unstagedPaths : stagedPaths;
          const nextFile = oppositePaths.includes(previous.file.path)
            ? {
                area: previous.file.area === "staged" ? ("unstaged" as const) : ("staged" as const),
                path: previous.file.path,
              }
            : null;
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "working-tree", file: nextFile },
            },
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectCommit: (ref, sha) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: { kind: "commit", sha },
          },
        })),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.branchBaseRefByThreadKey) &&
            !(threadKey in state.selectedTabsByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          const { [threadKey]: _removedSelectedTabs, ...selectedTabsByThreadKey } =
            state.selectedTabsByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey, selectedTabsByThreadKey };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 4,
      migrate: (persistedState, version) => {
        if (typeof persistedState !== "object" || persistedState === null) {
          return persistedState as DiffPanelStoreState;
        }
        const previous = persistedState as {
          byThreadKey?: Record<string, DiffPanelSelection | { kind: "unstaged" }>;
          branchBaseRefByThreadKey?: Record<string, string | null>;
          selectedTabByThreadKey?: Record<string, DiffPanelTab>;
        };
        if (version >= 4) return persistedState as DiffPanelStoreState;
        const byThreadKey = Object.fromEntries(
          Object.entries(previous.byThreadKey ?? {}).map(([key, selection]) => [
            key,
            version < 2 && selection.kind === "unstaged"
              ? ({ kind: "working-tree", file: null } satisfies DiffPanelSelection)
              : selection,
          ]),
        );
        const selectedTabsByThreadKey = Object.fromEntries(
          Object.entries(previous.selectedTabByThreadKey ?? {}).flatMap(([threadKey, tab]) => {
            const selection = byThreadKey[threadKey];
            return selection && selection.kind !== "unstaged"
              ? [[threadKey, { [diffPanelViewKey(selection)]: tab }]]
              : [];
          }),
        );
        return {
          byThreadKey,
          branchBaseRefByThreadKey: previous.branchBaseRefByThreadKey ?? {},
          selectedTabsByThreadKey,
        } as unknown as DiffPanelStoreState;
      },
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        selectedTabsByThreadKey: state.selectedTabsByThreadKey,
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return (
    byThreadKey[scopedThreadKey(ref)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}

export function diffPanelViewKey(selection: DiffPanelSelection): string {
  if (selection.kind === "branch") return `branch:${selection.baseRef ?? "default"}`;
  if (selection.kind === "commit") return `commit:${selection.sha}`;
  if (selection.kind === "turn") return `turn:${selection.turnId}`;
  return "working-tree";
}

export function selectThreadDiffPanelTab(
  selectedTabsByThreadKey: Record<string, DiffPanelTabsByView>,
  ref: ScopedThreadRef | null | undefined,
  selection: DiffPanelSelection,
): DiffPanelTab {
  return ref
    ? (selectedTabsByThreadKey[scopedThreadKey(ref)]?.[diffPanelViewKey(selection)] ?? "diff")
    : "diff";
}
