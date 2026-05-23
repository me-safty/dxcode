import { useEffect, useState } from "react";

import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import { getProjectTicketEstimatePresentation } from "~/t3work/t3work-projectBacklogEstimate";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function getProjectBacklogTableRowEstimateBaseline(ticket: ProjectTicket): string {
  const presentation = getProjectTicketEstimatePresentation(ticket);
  return presentation.numericValue !== undefined ? String(presentation.numericValue) : "";
}

export function useProjectBacklogTableRowDraft({
  ticket,
  onUpdateAssignee,
  onUpdateEstimate,
}: {
  ticket: ProjectTicket;
  onUpdateAssignee: (
    ticket: ProjectTicket,
    assignee: AtlassianAssignableUser | null,
  ) => Promise<void>;
  onUpdateEstimate: (ticket: ProjectTicket, estimateValue: number | null) => Promise<void>;
}) {
  const [assigneeBaseline, setAssigneeBaseline] = useState({
    label: ticket.assignee ?? "",
    accountId: ticket.assigneeAccountId ?? null,
  });
  const [assigneeDraft, setAssigneeDraftState] = useState<
    AtlassianAssignableUser | null | undefined
  >(undefined);
  const [estimateBaseline, setEstimateBaseline] = useState(
    getProjectBacklogTableRowEstimateBaseline(ticket),
  );
  const [estimateDraft, setEstimateDraftState] = useState(estimateBaseline);
  const [rowSaving, setRowSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    setAssigneeBaseline({
      label: ticket.assignee ?? "",
      accountId: ticket.assigneeAccountId ?? null,
    });
    setAssigneeDraftState(undefined);
  }, [ticket.assignee, ticket.assigneeAccountId, ticket.id]);

  useEffect(() => {
    const nextEstimateBaseline = getProjectBacklogTableRowEstimateBaseline(ticket);
    setEstimateBaseline(nextEstimateBaseline);
    setEstimateDraftState(nextEstimateBaseline);
  }, [ticket.estimateValue, ticket.id, ticket.timeOriginalEstimateSeconds]);

  function assigneeMatchesBaseline(assignee: AtlassianAssignableUser | null): boolean {
    if (assignee === null) {
      return assigneeBaseline.accountId === null && assigneeBaseline.label.length === 0;
    }

    return (
      assignee.accountId === assigneeBaseline.accountId &&
      assignee.displayName === assigneeBaseline.label
    );
  }

  const assigneeDirty = assigneeDraft !== undefined && !assigneeMatchesBaseline(assigneeDraft);
  const estimateDirty = estimateDraft.trim() !== estimateBaseline.trim();
  const rowDirty = assigneeDirty || estimateDirty;
  const selectedAssigneeLabel =
    assigneeDraft === undefined
      ? assigneeBaseline.label || "Unassigned"
      : assigneeDraft?.displayName || "Unassigned";

  async function commitRow() {
    if (rowSaving || !rowDirty) {
      return;
    }

    const trimmedEstimate = estimateDraft.trim();
    let nextEstimateValue: number | null = ticket.estimateValue ?? null;
    if (estimateDirty) {
      if (!trimmedEstimate) {
        nextEstimateValue = null;
      } else {
        const parsedValue = Number(trimmedEstimate);
        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
          setRowError("Estimate must be a non-negative number.");
          return;
        }
        nextEstimateValue = parsedValue;
      }
    }

    setRowSaving(true);
    setRowError(null);
    try {
      if (assigneeDirty) {
        const nextAssignee = assigneeDraft ?? null;
        await onUpdateAssignee(ticket, nextAssignee);
        setAssigneeBaseline({
          label: nextAssignee?.displayName ?? "",
          accountId: nextAssignee?.accountId ?? null,
        });
        setAssigneeDraftState(undefined);
      }

      if (estimateDirty) {
        await onUpdateEstimate(ticket, nextEstimateValue);
        const nextEstimateBaseline = nextEstimateValue === null ? "" : String(nextEstimateValue);
        setEstimateBaseline(nextEstimateBaseline);
        setEstimateDraftState(nextEstimateBaseline);
      }
    } catch (cause) {
      setRowError(cause instanceof Error ? cause.message : "Failed to save row changes.");
    } finally {
      setRowSaving(false);
    }
  }

  return {
    estimateDraft,
    estimateDirty,
    rowDirty,
    rowError,
    rowSaving,
    selectedAssigneeLabel,
    setAssigneeDraft(nextAssignee: AtlassianAssignableUser | null) {
      setRowError(null);
      setAssigneeDraftState(nextAssignee);
    },
    setEstimateDraft(nextValue: string) {
      setRowError(null);
      setEstimateDraftState(nextValue);
    },
    resetEstimateDraft() {
      setRowError(null);
      setEstimateDraftState(estimateBaseline);
    },
    commitRow,
  };
}
