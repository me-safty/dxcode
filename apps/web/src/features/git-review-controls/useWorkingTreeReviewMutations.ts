import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ReviewChangeArea,
  ReviewChangedFile,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { type Dispatch, type SetStateAction, useLayoutEffect, useRef, useState } from "react";

import { useDiffPanelStore } from "~/diffPanelStore";
import { reviewEnvironment } from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "~/components/ui/toast";
import type { OptimisticWorkingTreeTransfer } from "./optimisticWorkingTree";

interface WorkingTreeReviewContext {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly cwd: string | null | undefined;
  readonly threadRef: ScopedThreadRef | null;
}

export interface WorkingTreeReviewMutations {
  readonly pendingPaths: ReadonlySet<string>;
  readonly optimisticTransfers: ReadonlyArray<OptimisticWorkingTreeTransfer>;
  readonly mutationRevision: number;
  readonly setOptimisticTransfers: Dispatch<
    SetStateAction<ReadonlyArray<OptimisticWorkingTreeTransfer>>
  >;
  readonly selectAll: () => void;
  readonly selectFile: (area: ReviewChangeArea, path: string) => void;
  readonly transfer: (area: ReviewChangeArea, changes: ReadonlyArray<ReviewChangedFile>) => void;
  readonly discard: (changes: ReadonlyArray<ReviewChangedFile>) => void;
}

export function useWorkingTreeReviewMutations(
  context: WorkingTreeReviewContext,
): WorkingTreeReviewMutations {
  const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [optimisticTransfers, setOptimisticTransfers] = useState<
    ReadonlyArray<OptimisticWorkingTreeTransfer>
  >([]);
  const [mutationRevision, setMutationRevision] = useState(0);
  const contextKey = `${context.environmentId ?? ""}\0${context.cwd ?? ""}`;
  const pendingPathsRef = useRef<{ key: string; paths: Set<string> }>({
    key: contextKey,
    paths: new Set(),
  });

  useLayoutEffect(() => {
    pendingPathsRef.current = { key: contextKey, paths: new Set() };
    setPendingPaths(new Set());
    setOptimisticTransfers([]);
  }, [contextKey]);

  const stagePaths = useAtomCommand(reviewEnvironment.stagePaths, {
    label: "stage review files",
    reportFailure: false,
  });
  const unstagePaths = useAtomCommand(reviewEnvironment.unstagePaths, {
    label: "unstage review files",
    reportFailure: false,
  });
  const discardChanges = useAtomCommand(reviewEnvironment.discardChanges, {
    label: "discard review changes",
    reportFailure: false,
  });

  const selectAll = () => {
    if (!context.threadRef) return;
    useDiffPanelStore.getState().selectWorkingTreeAll(context.threadRef);
  };
  const selectFile = (area: ReviewChangeArea, path: string) => {
    if (!context.threadRef) return;
    useDiffPanelStore.getState().selectWorkingTreeFile(context.threadRef, area, path);
  };
  const transfer = (area: ReviewChangeArea, changes: ReadonlyArray<ReviewChangedFile>) => {
    const { environmentId, threadId, cwd } = context;
    if (!environmentId || !threadId || !cwd || changes.length === 0) return;
    const filePaths = changes.map((change) => change.path);
    const requestContextKey = contextKey;
    const pending = pendingPathsRef.current.paths;
    if (filePaths.some((path) => pending.has(path))) return;
    for (const path of filePaths) pending.add(path);
    setPendingPaths(new Set(pending));
    setOptimisticTransfers((current) => [
      ...current.filter(
        (item) => !filePaths.some((path) => item.from === area && item.path === path),
      ),
      ...filePaths.map((path) => ({ from: area, path })),
    ]);
    if (context.threadRef) {
      for (const path of filePaths) {
        const store = useDiffPanelStore.getState();
        if (area === "unstaged") store.transferWorkingTreeFileToStaged(context.threadRef, path);
        else store.transferWorkingTreeFileToUnstaged(context.threadRef, path);
      }
    }

    void (async () => {
      const result = await (area === "unstaged"
        ? stagePaths({
            environmentId,
            input: { cwd, threadId, paths: filePaths },
          })
        : unstagePaths({
            environmentId,
            input: {
              cwd,
              threadId,
              changes: changes.map(({ path, previousPath }) => ({ path, previousPath })),
            },
          }));
      const isCurrentContext = pendingPathsRef.current.key === requestContextKey;
      if (isCurrentContext) {
        for (const path of filePaths) pendingPathsRef.current.paths.delete(path);
        setPendingPaths(new Set(pendingPathsRef.current.paths));
      }
      if (!isCurrentContext) return;
      if (result._tag === "Failure") {
        setOptimisticTransfers((current) =>
          current.filter(
            (item) => !filePaths.some((path) => item.from === area && item.path === path),
          ),
        );
        if (context.threadRef) {
          for (const path of filePaths) {
            const store = useDiffPanelStore.getState();
            if (area === "unstaged") {
              store.transferWorkingTreeFileToUnstaged(context.threadRef, path);
            } else {
              store.transferWorkingTreeFileToStaged(context.threadRef, path);
            }
          }
        }
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: area === "unstaged" ? "Unable to stage files" : "Unable to unstage files",
            description:
              error instanceof Error
                ? error.message
                : `Could not ${area === "unstaged" ? "stage" : "unstage"} selected files.`,
          });
        }
      }
      if (pendingPathsRef.current.paths.size === 0) {
        setMutationRevision((current) => current + 1);
      }
    })();
  };

  const discard = (changes: ReadonlyArray<ReviewChangedFile>) => {
    const { environmentId, threadId, cwd } = context;
    if (!environmentId || !threadId || !cwd || changes.length === 0) return;
    const filePaths = changes.map((change) => change.path);
    const requestContextKey = contextKey;
    const pending = pendingPathsRef.current.paths;
    if (filePaths.some((path) => pending.has(path))) return;
    for (const path of filePaths) pending.add(path);
    setPendingPaths(new Set(pending));

    void (async () => {
      const result = await discardChanges({
        environmentId,
        input: {
          cwd,
          threadId,
          changes: changes.map(({ path, kind }) => ({ path, kind })),
        },
      });
      const isCurrentContext = pendingPathsRef.current.key === requestContextKey;
      if (isCurrentContext) {
        for (const path of filePaths) pendingPathsRef.current.paths.delete(path);
        setPendingPaths(new Set(pendingPathsRef.current.paths));
      }
      if (!isCurrentContext) return;
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Unable to discard changes",
            description:
              error instanceof Error ? error.message : "Could not discard selected changes.",
          });
        }
        return;
      }
      if (pendingPathsRef.current.paths.size === 0) {
        setMutationRevision((current) => current + 1);
      }
    })();
  };

  return {
    pendingPaths,
    optimisticTransfers,
    mutationRevision,
    setOptimisticTransfers,
    selectAll,
    selectFile,
    transfer,
    discard,
  };
}
