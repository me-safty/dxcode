// EMPOWERRD: branch-toolbar control to view/set/clear a thread's Jira key.
//
// Reads the current key from the fork `threadJiraKeysQuery` (Decision A: the key
// is not on the core thread payload) and writes via the `setThreadJiraKeyCommand`
// RPC. Branch rename behaviour: temp placeholder branches auto-rename; meaningful
// branches prompt for confirmation; preview/validation reuse the shared helpers.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { isMainOrMasterBranchName, validateJiraKeyInput } from "@t3tools/shared/jira";
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { resolveJiraKeySavePlan } from "./savePlan.ts";
import { setThreadJiraKeyCommand, threadJiraKeysQuery } from "./state.ts";

export interface BranchToolbarJiraKeyControlProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectCwd: string;
  readonly effectiveEnvMode: "local" | "worktree";
  readonly jiraProjectKey: string | null;
  readonly currentBranch: string | null;
  readonly title: string;
  readonly onComposerFocusRequest?: () => void;
}

export function BranchToolbarJiraKeyControl(props: BranchToolbarJiraKeyControlProps) {
  const {
    environmentId,
    threadId,
    projectCwd,
    effectiveEnvMode,
    jiraProjectKey,
    currentBranch,
    title,
  } = props;

  const jiraKeysQuery = useEnvironmentQuery(threadJiraKeysQuery({ environmentId, input: {} }));
  const currentJiraKey =
    jiraKeysQuery.data?.find((row) => row.threadId === threadId)?.jiraKey ?? null;
  const setJiraKey = useAtomCommand(setThreadJiraKeyCommand, { reportFailure: false });

  const vcsStatus = useEnvironmentQuery(
    effectiveEnvMode === "worktree"
      ? null
      : vcsEnvironment.status({ environmentId, input: { cwd: projectCwd } }),
  );
  const resolvedLocalBranch = vcsStatus.data?.refName ?? currentBranch;
  const jiraKeyAllowed =
    effectiveEnvMode === "worktree" ||
    (resolvedLocalBranch !== null && !isMainOrMasterBranchName(resolvedLocalBranch));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(currentJiraKey ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRename, setPendingRename] = useState<{
    readonly jiraKey: string;
    readonly targetBranch: string;
  } | null>(null);

  useEffect(() => {
    if (!dialogOpen) {
      setDraftValue(currentJiraKey ?? "");
    }
  }, [currentJiraKey, dialogOpen]);

  const validation = validateJiraKeyInput(draftValue, jiraProjectKey);
  const normalizedJiraKey = validation.normalized;
  const isBlockedByGuardrail = normalizedJiraKey !== null && !jiraKeyAllowed;
  const canSave =
    !isSaving &&
    validation.error === null &&
    !isBlockedByGuardrail &&
    normalizedJiraKey !== currentJiraKey;

  const applyKey = async (jiraKey: string | null, renameBranch: boolean) => {
    const result = await setJiraKey({ environmentId, input: { threadId, jiraKey, renameBranch } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      throw error instanceof Error ? error : new Error("Failed to save Jira key.");
    }
    jiraKeysQuery.refresh();
  };

  const handleSave = async () => {
    if (!canSave) {
      return;
    }
    setIsSaving(true);
    try {
      if (normalizedJiraKey === null) {
        await applyKey(null, false);
        setDialogOpen(false);
        props.onComposerFocusRequest?.();
        return;
      }

      const plan = resolveJiraKeySavePlan({ currentBranch, normalizedJiraKey, title });
      if (plan.kind === "save") {
        await applyKey(normalizedJiraKey, false);
        setDialogOpen(false);
        props.onComposerFocusRequest?.();
        return;
      }
      if (plan.kind === "autoRename") {
        await applyKey(normalizedJiraKey, true);
        setDialogOpen(false);
        props.onComposerFocusRequest?.();
        return;
      }

      // Meaningful branch: save the key now (no rename), then ask the user.
      await applyKey(normalizedJiraKey, false);
      setPendingRename({ jiraKey: normalizedJiraKey, targetBranch: plan.targetBranch });
      setDialogOpen(false);
      setConfirmOpen(true);
      props.onComposerFocusRequest?.();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to save Jira key",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmRename = async () => {
    if (!pendingRename) {
      return;
    }
    setIsSaving(true);
    try {
      await applyKey(pendingRename.jiraKey, true);
      setConfirmOpen(false);
      setPendingRename(null);
      props.onComposerFocusRequest?.();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename branch",
        description:
          error instanceof Error
            ? `${error.message} The Jira key was still saved.`
            : "The Jira key was saved, but the branch rename failed.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    try {
      await applyKey(null, false);
      setDialogOpen(false);
      props.onComposerFocusRequest?.();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to clear Jira key",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        className="font-medium text-muted-foreground/70"
        onClick={() => setDialogOpen(true)}
      >
        {currentJiraKey ? `Jira: ${currentJiraKey}` : "Add Jira Key"}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{currentJiraKey ? "Edit Jira key" : "Add Jira key"}</DialogTitle>
            <DialogDescription>
              Save an optional Jira key to this thread and use it for worktree branch naming.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2">
              <Input
                autoFocus
                placeholder={`${jiraProjectKey ?? "ABC"}-123`}
                value={draftValue}
                onChange={(event) => setDraftValue(event.currentTarget.value)}
              />
              {validation.error ? (
                <p className="text-destructive text-xs">{validation.error}</p>
              ) : null}
              {isBlockedByGuardrail ? (
                <p className="text-destructive text-xs">
                  Jira keys can only be set in a worktree or when the current checkout is not{" "}
                  <code>main</code> or <code>master</code>.
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Branches use <code>{normalizedJiraKey ?? "KEY"}/slug</code> when a Jira key is set.
              </p>
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            {currentJiraKey ? (
              <Button variant="outline" disabled={isSaving} onClick={() => void handleClear()}>
                Clear
              </Button>
            ) : null}
            <Button variant="outline" disabled={isSaving} onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={() => void handleSave()}>
              Save
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Rename branch to match Jira key?</DialogTitle>
            <DialogDescription>
              The Jira key has been saved. Rename the current branch to match it now?
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2 text-sm">
              <p>Current branch: {currentBranch ?? "(none)"}</p>
              <p>New branch: {pendingRename?.targetBranch ?? "(none)"}</p>
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                setConfirmOpen(false);
                setPendingRename(null);
                props.onComposerFocusRequest?.();
              }}
            >
              Keep current branch
            </Button>
            <Button disabled={isSaving} onClick={() => void confirmRename()}>
              Rename branch
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
