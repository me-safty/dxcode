import { useEffect, useRef, useState, type MouseEvent } from "react";

import { Badge } from "~/t3work/components/ui/t3work-badge";
import { Input } from "~/t3work/components/ui/t3work-input";
import { getProjectTicketEstimatePresentation } from "~/t3work/t3work-projectBacklogEstimate";
import { ProjectBacklogEstimateReadonlyValue } from "~/t3work/t3work-ProjectBacklogEstimateReadonly";
import { isProjectTicketHourTracked } from "~/t3work/t3work-projectBacklogUtils";
export { ProjectBacklogRowSubtaskCell } from "~/t3work/t3work-ProjectBacklogRowSubtaskCell";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function ProjectBacklogRowEstimateCell({
  ticket,
  estimateFieldLabel,
  onUpdateEstimate,
  compact = false,
  draftValue,
  onDraftChange,
  onCommitRequest,
  onResetDraft,
}: {
  ticket: ProjectTicket;
  estimateFieldLabel?: string;
  onUpdateEstimate: (ticket: ProjectTicket, estimateValue: number | null) => Promise<void>;
  compact?: boolean;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  onCommitRequest?: () => void;
  onResetDraft?: () => void;
}) {
  const estimatePresentation = getProjectTicketEstimatePresentation(
    ticket,
    estimateFieldLabel ? { storyPointsLabel: estimateFieldLabel } : undefined,
  );
  const resolvedEstimateLabel = estimatePresentation.label;
  const persistedEstimateDraft =
    estimatePresentation.numericValue !== undefined
      ? String(estimatePresentation.numericValue)
      : "";
  const isControlled = draftValue !== undefined && onDraftChange !== undefined;
  const [internalEstimateDraft, setInternalEstimateDraft] = useState(persistedEstimateDraft);
  const [estimateSaving, setEstimateSaving] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateInputContainerRef = useRef<HTMLDivElement | null>(null);
  const estimateDraft = isControlled ? draftValue : internalEstimateDraft;
  const estimateAvailable = isProjectTicketHourTracked(ticket) || Boolean(estimateFieldLabel);
  const readonlyEstimateClassName = compact
    ? "inline-flex h-7 min-w-[5.25rem] items-center justify-center gap-1 px-2 text-[11px] font-medium tabular-nums text-foreground/85"
    : "inline-flex h-8 min-w-[6rem] items-center justify-center gap-1 px-2 text-[12px] font-medium tabular-nums text-foreground/85";

  useEffect(() => {
    if (!isControlled) {
      setInternalEstimateDraft(persistedEstimateDraft);
    }
  }, [isControlled, persistedEstimateDraft]);

  function updateEstimateDraft(value: string) {
    setEstimateError(null);
    if (isControlled) {
      onDraftChange(value);
      return;
    }
    setInternalEstimateDraft(value);
  }

  function focusAndSelectEstimateInput() {
    const estimateInput =
      estimateInputContainerRef.current?.querySelector<HTMLInputElement>('[data-slot="input"]');

    if (!estimateInput || estimateInput.disabled) {
      return;
    }

    estimateInput.focus();
    estimateInput.select();
  }

  function handleEstimateWrapperMouseDown(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;

    if (target instanceof HTMLElement && target.closest('[data-slot="input"]')) {
      return;
    }

    event.preventDefault();
    focusAndSelectEstimateInput();
  }

  async function handleEstimateCommit() {
    const trimmed = estimateDraft.trim();
    if (!trimmed) {
      setEstimateSaving(true);
      setEstimateError(null);
      try {
        await onUpdateEstimate(ticket, null);
      } catch (cause) {
        setEstimateError(cause instanceof Error ? cause.message : "Failed to save estimate.");
      } finally {
        setEstimateSaving(false);
      }
      return;
    }

    const parsedValue = Number(trimmed);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setEstimateError("Estimate must be a non-negative number.");
      return;
    }

    setEstimateSaving(true);
    setEstimateError(null);
    try {
      await onUpdateEstimate(ticket, parsedValue);
    } catch (cause) {
      setEstimateError(cause instanceof Error ? cause.message : "Failed to save estimate.");
    } finally {
      setEstimateSaving(false);
    }
  }

  return (
    <div className="min-w-0">
      {compact ? null : (
        <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {resolvedEstimateLabel}
        </div>
      )}
      {estimateAvailable ? (
        !estimatePresentation.editable ? (
          <ProjectBacklogEstimateReadonlyValue
            presentation={estimatePresentation}
            className={readonlyEstimateClassName}
          />
        ) : (
          <div
            ref={estimateInputContainerRef}
            onMouseDown={handleEstimateWrapperMouseDown}
            className={
              compact
                ? "inline-flex h-7 min-w-[5.25rem] cursor-text items-center gap-1 rounded-md border border-border/70 bg-background/90 px-1.5"
                : "inline-flex h-8 cursor-text items-center rounded-md border border-border/70 bg-background/90 px-2"
            }
          >
            <Input
              aria-label={`${resolvedEstimateLabel} for ${ticket.ref.displayId}`}
              unstyled
              className={
                compact
                  ? "h-full w-11 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [&_[data-slot=input]]:h-full [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:text-right [&_[data-slot=input]]:text-[11px] [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:leading-none [&_[data-slot=input]]:tabular-nums"
                  : "h-6 w-14 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [&_[data-slot=input]]:h-6 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:text-right [&_[data-slot=input]]:text-[12px] [&_[data-slot=input]]:tabular-nums"
              }
              inputMode="decimal"
              type={compact ? "text" : "number"}
              value={estimateDraft}
              disabled={estimateSaving}
              onChange={(event) => updateEstimateDraft(event.target.value)}
              onBlur={() => {
                if (!compact && !isControlled) {
                  void handleEstimateCommit();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (onCommitRequest) {
                    onCommitRequest();
                  } else {
                    void handleEstimateCommit();
                  }
                }
                if (compact && event.key === "Escape") {
                  event.preventDefault();
                  if (onResetDraft) {
                    onResetDraft();
                  } else {
                    updateEstimateDraft(persistedEstimateDraft);
                  }
                  setEstimateError(null);
                }
              }}
              placeholder="0"
            />
            {estimatePresentation.valueSuffix ? (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {estimatePresentation.valueSuffix}
              </span>
            ) : null}
          </div>
        )
      ) : (
        <Badge variant="outline">Unavailable</Badge>
      )}
      {estimateError ? <div className="mt-1 text-xs text-destructive">{estimateError}</div> : null}
    </div>
  );
}
