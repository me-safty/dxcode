import type { ReviewChangeArea, ReviewChangedFile, ReviewChangeKind } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FileDiffIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { DiffStatLabel, hasNonZeroStat } from "../chat/DiffStatLabel";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ReviewFileSelection {
  readonly area: ReviewChangeArea;
  readonly path: string;
}

interface ReviewChangesSidebarProps {
  readonly staged: ReadonlyArray<ReviewChangedFile>;
  readonly unstaged: ReadonlyArray<ReviewChangedFile>;
  readonly truncated: boolean;
  readonly selection: ReviewFileSelection | null;
  readonly pendingPaths: ReadonlySet<string>;
  readonly theme: "light" | "dark";
  readonly onSelectAll: () => void;
  readonly onSelectFile: (area: ReviewChangeArea, path: string) => void;
  readonly onStageChanges: (changes: ReadonlyArray<ReviewChangedFile>) => void;
  readonly onUnstageChanges: (changes: ReadonlyArray<ReviewChangedFile>) => void;
  readonly onDiscardChanges: (changes: ReadonlyArray<ReviewChangedFile>) => void;
}

function splitFilePath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { name: path, parent: "" }
    : { name: path.slice(separator + 1), parent: path.slice(0, separator) };
}

const REVIEW_STATUS: Record<
  ReviewChangeKind,
  { readonly letter: string; readonly label: string; readonly className: string }
> = {
  modified: { letter: "M", label: "modified", className: "text-sky-500" },
  added: { letter: "A", label: "added", className: "text-emerald-500" },
  deleted: { letter: "D", label: "deleted", className: "text-destructive" },
  renamed: { letter: "R", label: "renamed", className: "text-amber-500" },
  copied: { letter: "C", label: "copied", className: "text-violet-500" },
  untracked: { letter: "U", label: "untracked", className: "text-teal-500" },
  conflicted: { letter: "!", label: "conflicted", className: "text-orange-500" },
};

function ReviewStatusIndicator({ kind }: { readonly kind: ReviewChangeKind }) {
  const status = REVIEW_STATUS[kind];
  return (
    <span
      role="img"
      aria-label={`Git status: ${status.label}`}
      title={status.label}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-[10px] font-semibold leading-none",
        status.className,
      )}
    >
      {status.letter}
    </span>
  );
}

function ReviewActionIcon({ area, pending }: { area: ReviewChangeArea; pending: boolean }) {
  if (pending) return <LoaderCircleIcon className="size-3.5 animate-spin" />;
  return area === "unstaged" ? (
    <PlusIcon className="size-3.5" strokeWidth={2} />
  ) : (
    <MinusIcon className="size-3.5" strokeWidth={2} />
  );
}

export function ReviewChangesSidebar(props: ReviewChangesSidebarProps) {
  const [discardCandidates, setDiscardCandidates] = useState<ReadonlyArray<ReviewChangedFile>>([]);
  const [collapsed, setCollapsed] = useState<Record<ReviewChangeArea, boolean>>({
    staged: false,
    unstaged: false,
  });
  const allChanges = [...props.staged, ...props.unstaged];
  const totalStat = allChanges.reduce(
    (total, file) => ({
      additions: total.additions + file.insertions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const renderSection = (area: ReviewChangeArea, files: ReadonlyArray<ReviewChangedFile>) => {
    const isCollapsed = collapsed[area];
    const label = area === "unstaged" ? "Unstaged Changes" : "Staged Changes";
    const actionLabel = area === "unstaged" ? "Stage all changes" : "Unstage all changes";
    const sectionPending = files.some((file) => props.pendingPaths.has(file.path));
    const bulkUnavailable = props.truncated || files.length === 0 || sectionPending;
    return (
      <section aria-label={label}>
        <div className="flex h-7 items-center text-[11px] font-medium text-muted-foreground uppercase tracking-wide hover:bg-muted/50">
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed((current) => ({ ...current, [area]: !current[area] }))}
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", isCollapsed && "-rotate-90")}
            />
            <span className="truncate">{label}</span>
            <span className="ml-auto tabular-nums">{files.length}</span>
          </button>
          {area === "unstaged" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    className="size-6 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Discard all unstaged changes"
                    disabled={bulkUnavailable}
                    onClick={() => setDiscardCandidates(files)}
                  />
                }
              >
                <Undo2Icon className="size-3.5" strokeWidth={2} />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {props.truncated
                  ? "Discard all unavailable: file list incomplete"
                  : "Discard all unstaged changes"}
              </TooltipPopup>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="mr-0.5 size-6 rounded-md"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={actionLabel}
                  disabled={bulkUnavailable}
                  onClick={() =>
                    area === "unstaged"
                      ? props.onStageChanges(files)
                      : props.onUnstageChanges(files)
                  }
                />
              }
            >
              <ReviewActionIcon area={area} pending={sectionPending} />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {props.truncated ? `${actionLabel} unavailable: file list incomplete` : actionLabel}
            </TooltipPopup>
          </Tooltip>
        </div>
        {!isCollapsed && (
          <div className="pb-1">
            {files.length === 0 ? (
              <p className="px-7 py-1.5 text-[11px] text-muted-foreground/65">No {area} changes</p>
            ) : (
              files.map((file) => {
                const pathParts = splitFilePath(file.path);
                const selected =
                  props.selection?.area === area && props.selection.path === file.path;
                const isPending = props.pendingPaths.has(file.path);
                return (
                  <div
                    key={`${area}:${file.path}`}
                    className={cn(
                      "group relative flex min-w-0 items-center rounded-sm px-1 hover:bg-accent/60",
                      selected && "bg-accent text-accent-foreground",
                    )}
                  >
                    <button
                      type="button"
                      className="flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-current={selected ? "true" : undefined}
                      title={file.path}
                      onClick={() => props.onSelectFile(area, file.path)}
                    >
                      <PierreEntryIcon
                        pathValue={file.path}
                        kind="file"
                        theme={props.theme}
                        className="size-3.5"
                      />
                      <ReviewStatusIndicator kind={file.kind} />
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        <span className="font-medium">{pathParts.name}</span>
                        {pathParts.parent && (
                          <span className="ml-1 text-muted-foreground/65">{pathParts.parent}</span>
                        )}
                      </span>
                      {(file.insertions > 0 || file.deletions > 0) && (
                        <span className="shrink-0 font-mono text-[9px] tabular-nums">
                          <DiffStatLabel
                            additions={file.insertions}
                            deletions={file.deletions}
                            layout="inline"
                          />
                        </span>
                      )}
                    </button>
                    <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-popover/95 opacity-0 shadow-xs transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      {area === "unstaged" && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                className="size-6 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`Discard changes to ${file.path}`}
                                disabled={isPending}
                                onClick={() => setDiscardCandidates([file])}
                              />
                            }
                          >
                            <Undo2Icon className="size-3.5" strokeWidth={2} />
                          </TooltipTrigger>
                          <TooltipPopup side="top">Discard changes</TooltipPopup>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              className="size-6 rounded-full text-muted-foreground"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`${area === "unstaged" ? "Stage" : "Unstage"} ${file.path}`}
                              disabled={isPending}
                              onClick={() =>
                                area === "unstaged"
                                  ? props.onStageChanges([file])
                                  : props.onUnstageChanges([file])
                              }
                            />
                          }
                        >
                          <ReviewActionIcon area={area} pending={isPending} />
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          {area === "unstaged" ? "Stage changes" : "Unstage changes"}
                        </TooltipPopup>
                      </Tooltip>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <aside className="min-h-0 max-h-[35%] min-w-0 overflow-auto border-b border-border bg-card/25 @min-[520px]:max-h-none @min-[520px]:w-[210px] @min-[520px]:shrink-0 @min-[520px]:border-r @min-[520px]:border-b-0">
        <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 p-1.5 backdrop-blur-sm">
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 text-left text-xs font-medium shadow-xs transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              props.selection === null &&
                "border-primary/35 bg-accent text-accent-foreground shadow-sm",
            )}
            aria-current={props.selection === null ? "true" : undefined}
            onClick={props.onSelectAll}
          >
            <FileDiffIcon className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">View all changes</span>
            {hasNonZeroStat(totalStat) && (
              <DiffStatLabel
                additions={totalStat.additions}
                deletions={totalStat.deletions}
                className="shrink-0 text-[10px]"
                layout="inline"
              />
            )}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
              {allChanges.length}
            </span>
          </button>
        </div>
        {props.truncated && (
          <p className="border-y border-border/60 bg-warning/10 px-3 py-1.5 text-[10px] text-muted-foreground">
            The changed-file list is incomplete because it exceeded the preview limit.
          </p>
        )}
        {renderSection("staged", props.staged)}
        {renderSection("unstaged", props.unstaged)}
      </aside>
      <AlertDialog
        open={discardCandidates.length > 0}
        onOpenChange={(open) => !open && setDiscardCandidates([])}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {discardCandidates.length > 1
                ? "Discard all unstaged changes?"
                : discardCandidates[0]?.kind === "untracked"
                  ? "Delete untracked file?"
                  : "Discard changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {discardCandidates.length > 1
                ? `Restore or delete all ${discardCandidates.length} unstaged files? This cannot be undone.`
                : discardCandidates[0]?.kind === "untracked"
                  ? `Delete ${discardCandidates[0].path}? This file is not tracked and cannot be recovered.`
                  : `Restore ${discardCandidates[0]?.path ?? "this file"} to its staged version? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (discardCandidates.length > 0) props.onDiscardChanges(discardCandidates);
                setDiscardCandidates([]);
              }}
            >
              {discardCandidates.length > 1
                ? "Discard all changes"
                : discardCandidates[0]?.kind === "untracked"
                  ? "Delete file"
                  : "Discard changes"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
