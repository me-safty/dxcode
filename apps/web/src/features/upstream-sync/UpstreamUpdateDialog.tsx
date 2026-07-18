import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, UpstreamTarget, UpstreamUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitMergeIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { buildThreadRouteParams } from "../../threadRoutes";
import { useAtomCommand } from "../../state/use-atom-command";
import { upstreamSyncEnvironment } from "../../state/upstreamSync";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { conflictDecisionRows, groupedNightlyLabel, shortCommit } from "./upstreamUpdate.logic";

interface UpstreamUpdateDialogProps {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly state: UpstreamUpdateState;
  readonly onOpenChange: (open: boolean) => void;
}

function stateTarget(state: UpstreamUpdateState): UpstreamTarget | null {
  if (state.status === "available" || state.status === "dismissed") return state.target;
  if (state.status === "session-active") return state.session.target;
  return null;
}

export function UpstreamUpdateDialog({
  open,
  environmentId,
  state,
  onOpenChange,
}: UpstreamUpdateDialogProps) {
  const navigate = useNavigate();
  const dismiss = useAtomCommand(upstreamSyncEnvironment.dismiss, { reportFailure: false });
  const prepare = useAtomCommand(upstreamSyncEnvironment.prepare, { reportFailure: false });
  const abort = useAtomCommand(upstreamSyncEnvironment.abort, { reportFailure: false });
  const [pending, setPending] = useState<"dismiss" | "prepare" | "abort" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = stateTarget(state);
  const session = state.status === "session-active" ? state.session : null;
  const rows = useMemo(() => (session ? conflictDecisionRows(session) : []), [session]);

  const errorMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : "Upstream synchronization failed.";
  };

  const handleDismiss = useCallback(async () => {
    if (!target) return;
    setPending("dismiss");
    const result = await dismiss({ environmentId, input: { target } });
    setPending(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(errorMessage(result));
      return;
    }
    onOpenChange(false);
  }, [dismiss, environmentId, onOpenChange, target]);

  const handlePrepare = useCallback(async () => {
    if (!target) return;
    setPending("prepare");
    setError(null);
    const result = await prepare({ environmentId, input: { target } });
    setPending(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(errorMessage(result));
      return;
    }
    onOpenChange(false);
    if (result.value.threadId) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
      });
    }
  }, [environmentId, navigate, onOpenChange, prepare, target]);

  const handleAbort = useCallback(async () => {
    if (!session) return;
    if (
      !window.confirm(
        "Abort the merge in this worktree? The branch and worktree will be preserved for recovery.",
      )
    ) {
      return;
    }
    setPending("abort");
    setError(null);
    const result = await abort({ environmentId, input: { sessionId: session.id } });
    setPending(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(errorMessage(result));
      return;
    }
    onOpenChange(false);
  }, [abort, environmentId, onOpenChange, session]);

  if (!target) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending !== null) return;
        if (!next && state.status === "available") {
          void handleDismiss();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMergeIcon className="size-5" />
            {session ? "T3 synchronization" : "T3 nightly update available"}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `Pinned to ${target.tag}. The merge remains uncommitted.`
              : "Review one grouped, immutable nightly target before creating a sync worktree."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <dl className="grid gap-3 rounded-xl border bg-muted/25 p-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Target</dt>
              <dd className="mt-1 font-mono text-foreground">{target.tag}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Target commit</dt>
              <dd className="mt-1 font-mono text-foreground">{shortCommit(target.commit)}</dd>
            </div>
            {state.status === "available" ? (
              <>
                <div>
                  <dt className="text-muted-foreground">Changes</dt>
                  <dd className="mt-1 text-foreground">{state.commitCount} upstream commits</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Grouped updates</dt>
                  <dd className="mt-1 text-foreground">
                    {groupedNightlyLabel(state.newerNightlyCount)}
                  </dd>
                </div>
                {state.previousDismissedTag ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Previously dismissed</dt>
                    <dd className="mt-1 font-mono text-foreground">{state.previousDismissedTag}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>

          {session ? (
            <section className="space-y-3" aria-labelledby="conflict-decision-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="conflict-decision-title" className="text-sm font-medium">
                  Conflict decision report
                </h3>
                <Badge variant={session.status === "conflicted" ? "warning" : "success"}>
                  {session.status}
                </Badge>
              </div>
              {rows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Upstream behavior</TableHead>
                      <TableHead>DX behavior</TableHead>
                      <TableHead>Suggested decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.file}>
                        <TableCell className="max-w-60 whitespace-normal font-mono">
                          {row.file}
                        </TableCell>
                        <TableCell>{row.upstream}</TableCell>
                        <TableCell>{row.dx}</TableCell>
                        <TableCell>{row.suggestion}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No overlapping files detected. The guided thread still verifies semantic behavior.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Compared {session.comparison.upstreamFileCount} upstream files with{" "}
                {session.comparison.dxFileCount} DX files from merge base{" "}
                <code>{shortCommit(session.comparison.baseCommit)}</code>.
              </p>
              {state.status === "session-active" && state.newerTarget ? (
                <div className="flex items-center gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning-foreground">
                  <TriangleAlertIcon className="size-4 shrink-0" />
                  A newer nightly {state.newerTarget.tag} is waiting. This session remains pinned.
                </div>
              ) : null}
            </section>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          {session ? (
            <>
              <Button variant="outline" onClick={handleAbort} disabled={pending !== null}>
                {pending === "abort" ? <LoaderIcon className="animate-spin" /> : null}
                Abort merge
              </Button>
              {session.threadId ? (
                <Button
                  onClick={() => {
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(environmentId, session.threadId!),
                      ),
                    });
                    onOpenChange(false);
                  }}
                >
                  Open guided thread
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleDismiss} disabled={pending !== null}>
                {pending === "dismiss" ? <LoaderIcon className="animate-spin" /> : null}
                Later
              </Button>
              <Button onClick={handlePrepare} disabled={pending !== null}>
                {pending === "prepare" ? <LoaderIcon className="animate-spin" /> : null}
                Review update
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
