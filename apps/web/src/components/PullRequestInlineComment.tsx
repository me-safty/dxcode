import type { PullRequestReviewComment } from "@t3tools/contracts";
import { CornerDownLeftIcon, XIcon } from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export interface PendingReviewComment {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly side: "deletions" | "additions";
  readonly body: string;
}

export interface LineAnnotationData {
  readonly path: string;
  readonly line: number;
  readonly side: "deletions" | "additions";
  readonly existing: ReadonlyArray<PullRequestReviewComment>;
  readonly pending: ReadonlyArray<PendingReviewComment>;
}

function formatRelativeOrAbsolute(value: string): string {
  if (!value) return "";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return value;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

interface InlineCommentThreadProps {
  data: LineAnnotationData;
  onDiscardPending: (pendingId: string) => void;
  onAddReply: (path: string, line: number, side: "deletions" | "additions", body: string) => void;
}

export const InlineCommentThread = memo(function InlineCommentThread({
  data,
  onDiscardPending,
  onAddReply,
}: InlineCommentThreadProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");

  const handleReply = () => {
    const body = replyDraft.trim();
    if (!body) return;
    onAddReply(data.path, data.line, data.side, body);
    setReplyDraft("");
    setReplyOpen(false);
  };

  return (
    <div className="my-2 ml-12 mr-2 max-w-3xl space-y-2">
      {data.existing.map((comment) => (
        <article
          key={`existing-${comment.id}`}
          className="rounded-lg border border-border/70 bg-background p-3 shadow-sm"
        >
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{comment.user || "unknown"}</span>
            <span className="tabular-nums">{formatRelativeOrAbsolute(comment.createdAt)}</span>
          </header>
          {comment.body.length > 0 ? <ChatMarkdown text={comment.body} cwd={undefined} /> : null}
        </article>
      ))}
      {data.pending.map((pending) => (
        <article
          key={pending.id}
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 shadow-sm"
        >
          <header className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-300">
              Pending
            </span>
            <button
              type="button"
              onClick={() => onDiscardPending(pending.id)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
              title="Discard pending comment"
            >
              <XIcon className="size-3" aria-hidden="true" />
              Discard
            </button>
          </header>
          {pending.body.length > 0 ? <ChatMarkdown text={pending.body} cwd={undefined} /> : null}
        </article>
      ))}
      {replyOpen ? (
        <div className="rounded-lg border border-border/70 bg-background p-2">
          <textarea
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            rows={3}
            autoFocus
            placeholder="Write a reply…"
            className="w-full resize-none rounded-md border border-border/70 bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setReplyOpen(false);
                setReplyDraft("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleReply}
              disabled={replyDraft.trim().length === 0}
            >
              <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
              Add as pending
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReplyOpen(true)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          + Reply
        </button>
      )}
    </div>
  );
});

interface InlineCommentComposerProps {
  path: string;
  line: number;
  side: "deletions" | "additions";
  onSubmit: (path: string, line: number, side: "deletions" | "additions", body: string) => void;
  onCancel: () => void;
}

export function InlineCommentComposer({
  path,
  line,
  side,
  onSubmit,
  onCancel,
}: InlineCommentComposerProps) {
  const [draft, setDraft] = useState("");
  return (
    <div className="my-2 ml-12 mr-2 max-w-3xl rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-300">
          New pending comment
        </span>
        <span className="font-mono">
          {path}:{line}
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        autoFocus
        placeholder="Leave a comment on this line…"
        className={cn(
          "w-full resize-none rounded-md border border-border/70 bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
        )}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const body = draft.trim();
            if (!body) return;
            onSubmit(path, line, side, body);
            setDraft("");
          }}
          disabled={draft.trim().length === 0}
        >
          Add as pending
        </Button>
      </div>
    </div>
  );
}

interface InlinePostingIndicatorProps {
  message?: string;
}

export function InlinePostingIndicator({ message }: InlinePostingIndicatorProps) {
  return (
    <div className="my-2 ml-12 mr-2 flex max-w-3xl items-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      {message ?? "Posting…"}
    </div>
  );
}
