import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureEnvironmentApi } from "../environmentApi";
import { invalidateSourceControlState } from "../lib/sourceControlActions";
import {
  classifyManagedWorktrees,
  selectWorktreesForScope,
  type WorktreeThreadRef,
} from "../worktreeCleanup";
import {
  buildRemovalItems,
  type CleanupRowState,
  formatBytes,
  totalSelectedBytes,
} from "./WorktreeCleanupDialog.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface WorktreeCleanupDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  cwd: string;
  scope: "orphaned" | "orphaned-archived";
  threadRefs: readonly WorktreeThreadRef[];
  onOpenChange: (open: boolean) => void;
}

export function WorktreeCleanupDialog({
  open,
  environmentId,
  cwd,
  scope,
  threadRefs,
  onOpenChange,
}: WorktreeCleanupDialogProps) {
  const [rows, setRows] = useState<CleanupRowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Hold the latest threadRefs in a ref so frequent thread-store updates don't
  // re-run the load effect and discard the user's in-progress selection.
  const threadRefsRef = useRef(threadRefs);
  threadRefsRef.current = threadRefs;

  useEffect(() => {
    if (!open) {
      setRows([]);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const api = ensureEnvironmentApi(environmentId);
        const { worktrees } = await api.vcs.listManagedWorktrees({ cwd });
        const selected = selectWorktreesForScope(
          classifyManagedWorktrees(worktrees, threadRefsRef.current),
          scope,
        );
        if (cancelled) return;
        setRows(
          selected.map((entry) => ({
            path: entry.worktree.path,
            refName: entry.worktree.refName,
            classification: entry.classification,
            isDirty: entry.worktree.isDirty,
            selected: !entry.worktree.isDirty,
            force: false,
            sizeBytes: null,
          })),
        );
        for (const entry of selected) {
          void api.vcs
            .worktreeSize({ path: entry.worktree.path })
            .then(({ sizeBytes }) => {
              if (cancelled) return;
              setRows((current) =>
                current.map((row) =>
                  row.path === entry.worktree.path ? { ...row, sizeBytes } : row,
                ),
              );
            })
            .catch(() => {
              /* leave sizeBytes null => shown as unknown, excluded from total */
            });
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Failed to load worktrees.";
        setLoadError(message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not load worktrees",
            description: message,
          }),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, environmentId, cwd, scope]);

  const setRow = useCallback((path: string, patch: Partial<CleanupRowState>) => {
    setRows((current) => current.map((row) => (row.path === path ? { ...row, ...patch } : row)));
  }, []);

  const handleConfirm = useCallback(async () => {
    const items = buildRemovalItems(rows);
    if (items.length === 0) {
      onOpenChange(false);
      return;
    }
    setRemoving(true);
    try {
      const api = ensureEnvironmentApi(environmentId);
      const { results } = await api.vcs.removeWorktrees({ cwd, items });
      await invalidateSourceControlState({ environmentId });
      const removed = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      const freed = removed.reduce((sum, result) => {
        const row = rows.find((candidate) => candidate.path === result.path);
        return sum + (row?.sizeBytes ?? 0);
      }, 0);
      toastManager.add(
        stackedThreadToast({
          type: failed.length > 0 ? "warning" : "success",
          title:
            failed.length > 0
              ? `Removed ${removed.length}, ${failed.length} failed`
              : `Removed ${removed.length} worktree${removed.length === 1 ? "" : "s"}`,
          description: `Freed ${formatBytes(freed)}.${
            failed.length > 0 ? ` Failed: ${failed.map((failure) => failure.path).join(", ")}` : ""
          }`,
        }),
      );
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to remove worktrees.";
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Worktree cleanup failed",
          description: message,
        }),
      );
    } finally {
      setRemoving(false);
    }
  }, [rows, environmentId, cwd, onOpenChange]);

  const total = totalSelectedBytes(rows);
  const removableCount = buildRemovalItems(rows).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Clean up worktrees</DialogTitle>
          <DialogDescription>
            Remove t3code-managed worktrees for this repository. Dirty worktrees require an explicit
            force toggle.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Scanning worktrees…</p>
        ) : loadError ? (
          <p className="px-1 py-4 text-sm text-destructive">
            Could not load worktrees: {loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Nothing to clean up.</p>
        ) : (
          <ul className="flex flex-col gap-2 py-2">
            {rows.map((row) => (
              <li key={row.path} className="flex items-center gap-3 rounded-md border p-2">
                <input
                  type="checkbox"
                  checked={row.selected}
                  disabled={row.classification === "active"}
                  onChange={(event) => setRow(row.path, { selected: event.target.checked })}
                  aria-label={`Select ${row.refName}`}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{row.refName}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.path}</span>
                </div>
                {row.isDirty ? (
                  <label className="flex items-center gap-1 text-xs text-amber-600">
                    <input
                      type="checkbox"
                      checked={row.force}
                      onChange={(event) => setRow(row.path, { force: event.target.checked })}
                      aria-label={`Force remove ${row.refName}`}
                    />
                    force (dirty)
                  </label>
                ) : null}
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                  {row.sizeBytes === null ? "…" : formatBytes(row.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground">
            Reclaimable: {formatBytes(total)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={removing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={removing || removableCount === 0}
          >
            {removing ? "Removing…" : `Remove ${removableCount}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
