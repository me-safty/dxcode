import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { Badge } from "~/t3work/components/ui/t3work-badge";
import { JiraIssueTypeIcon } from "~/t3work/components/ticket/t3work-JiraIssueType";
import type { ResourceSnapshot } from "@t3tools/project-context";

interface TicketMetadataProps {
  snapshot: ResourceSnapshot | null;
  displayId: string | undefined;
  title: string;
  issueType?: string | undefined;
  issueTypeIconUrl?: string | undefined;
  status: string;
  priority?: string | undefined;
  assignee?: string | undefined;
}

export function TicketMetadata({
  snapshot,
  displayId,
  title,
  issueType,
  issueTypeIconUrl,
  status,
  priority,
  assignee,
}: TicketMetadataProps) {
  const fields = snapshot?.fields as Record<string, unknown> | undefined;
  const reporter = fields?.reporter as string | undefined;
  const labels = fields?.labels as string[] | undefined;
  const createdAt = snapshot?.fetchedAt;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <JiraIssueTypeIcon
            issueType={issueType}
            issueTypeIconUrl={issueTypeIconUrl}
            className="size-5"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono text-muted-foreground">{displayId}</span>
              <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {status}
              </span>
              {priority && (
                <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {priority}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-base font-semibold leading-snug">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {assignee && <span>Assigned to {assignee}</span>}
              {reporter && <span>Reported by {reporter}</span>}
              {createdAt && <span>Updated {new Date(createdAt).toLocaleDateString()}</span>}
            </div>
            {labels && labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-[10px]">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
