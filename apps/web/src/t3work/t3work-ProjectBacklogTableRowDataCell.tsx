import type { AtlassianAssignableUser } from "~/t3work/backend/t3work-types";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import { Badge } from "~/t3work/components/ui/t3work-badge";
import { formatRelativeTime } from "~/t3work/t3work-AppTicketHelpers";
import { ProjectBacklogRowAssigneeCell } from "~/t3work/t3work-ProjectBacklogRowAssigneeCell";
import { ProjectBacklogRowEstimateCell } from "~/t3work/t3work-ProjectBacklogRowPlanningCells";
import type { ProjectBacklogTableColumnId } from "~/t3work/t3work-projectBacklogTable";
import type { ProjectTicket } from "~/t3work/t3work-types";

function getAbsoluteUpdatedLabel(updatedAt: string): string {
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : updatedAt;
}

export function ProjectBacklogTableRowDataCell({
  columnId,
  ticket,
  parentTicket,
  estimateFieldLabel,
  selectedAssigneeLabel,
  estimateDraft,
  onSelectAssignee,
  onEstimateDraftChange,
  onEstimateReset,
  onCommitRow,
  onSearchAssignableUsers,
  onUpdateAssignee,
  onUpdateEstimate,
}: {
  columnId: ProjectBacklogTableColumnId;
  ticket: ProjectTicket;
  parentTicket?: ProjectTicket;
  estimateFieldLabel?: string;
  selectedAssigneeLabel: string;
  estimateDraft: string;
  onSelectAssignee: (assignee: AtlassianAssignableUser | null) => void;
  onEstimateDraftChange: (value: string) => void;
  onEstimateReset: () => void;
  onCommitRow: () => void;
  onSearchAssignableUsers: (
    ticket: ProjectTicket,
    query?: string,
  ) => Promise<ReadonlyArray<AtlassianAssignableUser>>;
  onUpdateAssignee: (
    ticket: ProjectTicket,
    assignee: AtlassianAssignableUser | null,
  ) => Promise<void>;
  onUpdateEstimate: (ticket: ProjectTicket, estimateValue: number | null) => Promise<void>;
}) {
  if (columnId === "status") {
    return (
      <td className="px-3 py-1.5 align-middle text-[11px] text-foreground/85">
        <span className="inline-flex min-h-7 items-center">{ticket.status}</span>
      </td>
    );
  }

  if (columnId === "assignee") {
    return (
      <td className="px-3 py-1.5 align-middle">
        <ProjectBacklogRowAssigneeCell
          compact
          ticket={ticket}
          selectedAssigneeLabel={selectedAssigneeLabel}
          onSelectAssignee={onSelectAssignee}
          onSearchAssignableUsers={onSearchAssignableUsers}
          onUpdateAssignee={onUpdateAssignee}
        />
      </td>
    );
  }

  if (columnId === "estimate") {
    return (
      <td className="px-3 py-1.5 align-middle">
        <ProjectBacklogRowEstimateCell
          compact
          ticket={ticket}
          draftValue={estimateDraft}
          onDraftChange={onEstimateDraftChange}
          onCommitRequest={onCommitRow}
          onResetDraft={onEstimateReset}
          onUpdateEstimate={onUpdateEstimate}
          {...(estimateFieldLabel ? { estimateFieldLabel } : {})}
        />
      </td>
    );
  }

  if (columnId === "parent") {
    const parentLabel = parentTicket?.ref.displayId ?? ticket.parentId;

    return (
      <td className="px-3 py-1.5 align-middle text-[11px] leading-tight">
        {parentLabel ? (
          <div className="min-w-0" title={parentTicket?.ref.title ?? parentLabel}>
            <div className="truncate font-mono text-foreground/80">{parentLabel}</div>
            {parentTicket?.ref.title ? (
              <div className="truncate text-muted-foreground">{parentTicket.ref.title}</div>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">No parent</span>
        )}
      </td>
    );
  }

  if (columnId === "updated") {
    return (
      <td className="px-3 py-1.5 align-middle">
        <span
          className="inline-flex min-h-7 items-center rounded-md border border-border/60 bg-muted/25 px-2 text-[11px] tabular-nums text-foreground/85"
          title={getAbsoluteUpdatedLabel(ticket.updatedAt)}
        >
          {formatRelativeTime(ticket.updatedAt)}
        </span>
      </td>
    );
  }

  if (columnId === "issue-type") {
    const issueType = ticket.issueType ?? ticket.ref.type ?? "Issue";
    const issueTypeIconUrl = ticket.issueTypeIconUrl ?? ticket.ref.issueTypeIconUrl;

    return (
      <td className="px-3 py-1.5 align-middle text-[11px]">
        <span className="inline-flex min-w-0 items-center gap-2">
          <JiraIssueTypeIcon
            issueType={issueType}
            issueTypeIconUrl={issueTypeIconUrl}
            className="size-4"
          />
          <span className="truncate text-foreground/85">{issueType}</span>
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-1.5 align-middle">
      <div className="flex min-h-7 items-center">
        <Badge variant="outline">{ticket.subtaskCount ?? 0}</Badge>
      </div>
    </td>
  );
}
