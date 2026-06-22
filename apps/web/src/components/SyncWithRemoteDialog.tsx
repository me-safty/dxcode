import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { gitEnvironment } from "~/state/git";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";

// Matches PullRequestPickerDialog's select styling so the two pickers feel
// identical. `appearance-none` hides the native arrow for our own chevron.
const PICKER_CONTROL_CLASS =
  "h-9 w-full appearance-none rounded-lg border border-input bg-background pl-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const PICKER_SELECT_CHEVRON_CLASS =
  "pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground/70";

interface SyncWithRemoteDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  cwd: string | null;
  projectName: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: { remoteName: string; branch: string }) => void;
}

export function SyncWithRemoteDialog({
  open,
  environmentId,
  cwd,
  projectName,
  onOpenChange,
  onSelect,
}: SyncWithRemoteDialogProps) {
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const remotesQuery = useEnvironmentQuery(
    open && cwd !== null ? gitEnvironment.listRemotes({ environmentId, input: { cwd } }) : null,
  );
  const remotes = remotesQuery.data?.remotes ?? [];

  // Reset transient state whenever the dialog is closed.
  useEffect(() => {
    if (!open) {
      setSelectedRemote(null);
      setSelectedBranch(null);
    }
  }, [open]);

  // Default the remote to `origin` (then primary, then first) once loaded.
  useEffect(() => {
    if (selectedRemote !== null || remotes.length === 0) return;
    const preferred =
      remotes.find((remote) => remote.name === "origin") ??
      remotes.find((remote) => remote.isPrimary) ??
      remotes[0];
    if (preferred) {
      setSelectedRemote(preferred.name);
    }
  }, [remotes, selectedRemote]);

  // Reset the branch whenever the active remote changes.
  useEffect(() => {
    setSelectedBranch(null);
  }, [selectedRemote]);

  const branchesQuery = useEnvironmentQuery(
    open && cwd !== null && selectedRemote !== null
      ? gitEnvironment.listRemoteBranches({
          environmentId,
          input: { cwd, remote: selectedRemote },
        })
      : null,
  );
  const branches = branchesQuery.data?.branches ?? [];
  const defaultBranch = branchesQuery.data?.defaultBranch ?? null;

  // Default-select the remote's default branch (then first) once branches load.
  useEffect(() => {
    if (selectedBranch !== null || branches.length === 0) return;
    const preferred =
      defaultBranch !== null && branches.includes(defaultBranch) ? defaultBranch : branches[0];
    if (preferred) {
      setSelectedBranch(preferred);
    }
  }, [branches, defaultBranch, selectedBranch]);

  const canSync = selectedRemote !== null && selectedBranch !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCwIcon className="size-4" />
            Sync with remote
          </DialogTitle>
          <DialogDescription>
            Fetch and merge a remote branch into this thread's branch in {projectName}. Conflicts
            are resolved automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Remote</span>
            <div className="relative">
              <select
                value={selectedRemote ?? ""}
                onChange={(event) => setSelectedRemote(event.target.value)}
                disabled={remotes.length === 0}
                className={PICKER_CONTROL_CLASS}
              >
                {remotes.length === 0 ? (
                  <option value="">{remotesQuery.isPending ? "Loading…" : "No remotes"}</option>
                ) : null}
                {remotes.map((remote) => (
                  <option key={remote.name} value={remote.name}>
                    {remote.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className={PICKER_SELECT_CHEVRON_CLASS} />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Branch</span>
            <div className="relative">
              <select
                value={selectedBranch ?? ""}
                onChange={(event) => setSelectedBranch(event.target.value)}
                disabled={branches.length === 0}
                className={PICKER_CONTROL_CLASS}
              >
                {branches.length === 0 ? (
                  <option value="">
                    {branchesQuery.isPending
                      ? "Loading…"
                      : branchesQuery.error
                        ? "Failed to load branches"
                        : "No branches"}
                  </option>
                ) : null}
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                    {branch === defaultBranch ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className={PICKER_SELECT_CHEVRON_CLASS} />
            </div>
          </label>

          {branchesQuery.isPending && selectedRemote !== null ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Loading branches from {selectedRemote}…
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSync}
            onClick={() => {
              if (selectedRemote !== null && selectedBranch !== null) {
                onSelect({ remoteName: selectedRemote, branch: selectedBranch });
              }
            }}
          >
            <RefreshCwIcon className="size-4" />
            Sync
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
