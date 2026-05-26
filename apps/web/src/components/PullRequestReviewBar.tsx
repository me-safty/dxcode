import type { PullRequestReviewEvent } from "@t3tools/contracts";
import { CheckCircle2Icon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

interface PullRequestReviewBarProps {
  pendingCount: number;
  onDiscardAll: () => void;
  onSubmit: (event: PullRequestReviewEvent, body: string) => Promise<void> | void;
  isSubmitting: boolean;
  canApprove: boolean;
  canRequestChanges: boolean;
}

interface SubmitDialogState {
  event: PullRequestReviewEvent;
  body: string;
  open: boolean;
}

export function PullRequestReviewBar({
  pendingCount,
  onDiscardAll,
  onSubmit,
  isSubmitting,
  canApprove,
  canRequestChanges,
}: PullRequestReviewBarProps) {
  const [dialog, setDialog] = useState<SubmitDialogState | null>(null);

  const openDialog = (event: PullRequestReviewEvent) => {
    setDialog({ event, body: "", open: true });
  };

  const closeDialog = () => {
    setDialog(null);
  };

  const handleConfirm = async () => {
    if (!dialog) return;
    await onSubmit(dialog.event, dialog.body);
    closeDialog();
  };

  const labelFor = (event: PullRequestReviewEvent): string => {
    if (event === "APPROVE") return "Approve";
    if (event === "REQUEST_CHANGES") return "Request changes";
    return "Comment";
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-4 py-2 backdrop-blur",
        )}
      >
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
              pendingCount > 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                : "border-border/70 text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{pendingCount}</span>
            {pendingCount === 1 ? "pending comment" : "pending comments"}
          </span>
          {pendingCount > 0 ? (
            <button
              type="button"
              onClick={onDiscardAll}
              className="text-[11px] underline-offset-2 hover:text-foreground hover:underline"
            >
              Discard all
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openDialog("COMMENT")}
            disabled={isSubmitting}
            title="Submit pending comments without an approval verdict"
          >
            <MessageSquareIcon className="size-3.5" aria-hidden="true" />
            Comment
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openDialog("REQUEST_CHANGES")}
            disabled={isSubmitting || !canRequestChanges}
            title={
              canRequestChanges ? "Request changes" : "You can't request changes on your own PR"
            }
          >
            <XCircleIcon className="size-3.5 text-destructive" aria-hidden="true" />
            Request changes
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openDialog("APPROVE")}
            disabled={isSubmitting || !canApprove}
            title={canApprove ? "Approve PR" : "You can't approve your own PR"}
          >
            {isSubmitting ? (
              <Spinner className="size-3.5" />
            ) : (
              <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
            )}
            Approve
          </Button>
        </div>
      </div>

      <Dialog
        open={dialog?.open ?? false}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog ? `${labelFor(dialog.event)} review` : "Submit review"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-1">
            <p className="text-xs text-muted-foreground">
              {pendingCount > 0
                ? `${pendingCount} pending ${pendingCount === 1 ? "comment" : "comments"} will be posted, then a ${labelFor(dialog?.event ?? "COMMENT").toLowerCase()} review will be submitted.`
                : "Submitting a review without pending comments."}
            </p>
            <textarea
              value={dialog?.body ?? ""}
              onChange={(event) =>
                setDialog((prev) => (prev ? { ...prev, body: event.target.value } : prev))
              }
              rows={4}
              placeholder="Optional summary…"
              className="w-full resize-none rounded-md border border-border/70 bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
              disabled={isSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeDialog}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Spinner className="size-3.5" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
