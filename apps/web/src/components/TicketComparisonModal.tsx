import { memo, useEffect, useState } from "react";
import { ExternalLinkIcon, LoaderIcon } from "lucide-react";
import { readNativeApi } from "~/nativeApi";
import type { JiraTicket } from "@t3tools/contracts";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface TicketComparisonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jiraTicketKey: string | null;
  secDeskTicketKey: string | null;
}

export const TicketComparisonModal = memo(function TicketComparisonModal({
  open,
  onOpenChange,
  jiraTicketKey,
  secDeskTicketKey,
}: TicketComparisonModalProps) {
  const [jiraTicket, setJiraTicket] = useState<JiraTicket | null>(null);
  const [secDeskTicket, setSecDeskTicket] = useState<JiraTicket | null>(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [secDeskLoading, setSecDeskLoading] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [secDeskError, setSecDeskError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setJiraTicket(null);
    setSecDeskTicket(null);
    setJiraError(null);
    setSecDeskError(null);

    const api = readNativeApi();
    if (!api) return;

    if (jiraTicketKey) {
      setJiraLoading(true);
      void api.jira
        .get({ ticketKey: jiraTicketKey })
        .then((t) => setJiraTicket(t))
        .catch((e) => setJiraError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setJiraLoading(false));
    }

    if (secDeskTicketKey) {
      setSecDeskLoading(true);
      void api.jira
        .get({ ticketKey: secDeskTicketKey })
        .then((t) => setSecDeskTicket(t))
        .catch((e) => setSecDeskError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setSecDeskLoading(false));
    }
  }, [open, jiraTicketKey, secDeskTicketKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Compare Tickets
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-2 gap-4 max-h-[65vh] overflow-y-auto">
            {/* Left: Original Jira ticket */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <span className="text-xs font-medium text-muted-foreground">Jira Ticket</span>
                {jiraTicket && (
                  <a
                    href={jiraTicket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                  >
                    {jiraTicket.key}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </div>
              {jiraLoading ? (
                <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" />
                  <span className="text-xs">Loading...</span>
                </div>
              ) : jiraError ? (
                <p className="text-xs text-destructive py-4">{jiraError}</p>
              ) : jiraTicket ? (
                <TicketDetail ticket={jiraTicket} />
              ) : (
                <p className="text-xs text-muted-foreground py-4">No ticket key provided</p>
              )}
            </div>

            {/* Right: SECDESK ticket */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <span className="text-xs font-medium text-muted-foreground">SECDESK Ticket</span>
                {secDeskTicket && (
                  <a
                    href={secDeskTicket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                  >
                    {secDeskTicket.key}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                )}
              </div>
              {secDeskLoading ? (
                <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" />
                  <span className="text-xs">Loading...</span>
                </div>
              ) : secDeskError ? (
                <p className="text-xs text-destructive py-4">{secDeskError}</p>
              ) : secDeskTicket ? (
                <TicketDetail ticket={secDeskTicket} />
              ) : (
                <p className="text-xs text-muted-foreground py-4">No SECDESK ticket linked</p>
              )}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
});

function TicketDetail({ ticket }: { ticket: JiraTicket }) {
  return (
    <div className="space-y-2.5">
      <div>
        <span className="text-sm font-medium text-foreground">{ticket.summary}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Field label="Status" value={ticket.status} />
        <Field label="Priority" value={ticket.priority} />
        <Field label="Type" value={ticket.issueType} />
        <Field label="Assignee" value={ticket.assignee ?? "Unassigned"} />
        {ticket.reporter && <Field label="Reporter" value={ticket.reporter} />}
        {ticket.parentKey && <Field label="Parent" value={ticket.parentKey} />}
        <Field label="Created" value={formatDate(ticket.created)} />
        <Field label="Updated" value={formatDate(ticket.updated)} />
      </div>

      {ticket.components.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground">Components</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {ticket.components.map((c) => (
              <span
                key={c}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {ticket.labels.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground">Labels</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {ticket.labels.map((l) => (
              <span
                key={l}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {ticket.description && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground">Description</span>
          <div className="mt-1 rounded border border-border/50 bg-secondary/30 p-2 text-xs text-foreground/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {ticket.description}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="text-foreground/90">{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
