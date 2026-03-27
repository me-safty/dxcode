import { memo, useCallback, useEffect, useState } from "react";
import { readNativeApi } from "~/nativeApi";
import { useSecDeskStore } from "~/secDeskStore";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";

interface SecDeskRequestType {
  id: string;
  name: string;
  description?: string | undefined;
}

interface SecDeskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSummary?: string;
  defaultDescription?: string;
  ticketKey?: string | undefined;
  projectCwd?: string | undefined;
}

export const SecDeskModal = memo(function SecDeskModal({
  open,
  onOpenChange,
  defaultSummary = "",
  defaultDescription = "",
  ticketKey,
  projectCwd,
}: SecDeskModalProps) {
  const setSecDeskLink = useSecDeskStore((s) => s.setLink);
  const [requestTypes, setRequestTypes] = useState<SecDeskRequestType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [summary, setSummary] = useState(defaultSummary);
  const [description, setDescription] = useState(defaultDescription);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ issueKey: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSummary(defaultSummary);
    setDescription(defaultDescription);
    setResult(null);
    setError(null);

    const api = readNativeApi();
    if (!api) return;
    void api.jira.listSecDeskRequestTypes().then((types) => {
      setRequestTypes(types);
      // Default to "AWS/Cloud Access" if available, otherwise first
      const awsType = types.find((t) => t.name.includes("AWS"));
      setSelectedTypeId(awsType?.id ?? types[0]?.id ?? "");
    }).catch(() => setRequestTypes([]));
  }, [open, defaultSummary, defaultDescription]);

  const handleSubmit = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !selectedTypeId || !summary.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.jira.createSecDeskRequest({
        requestTypeId: selectedTypeId,
        summary: summary.trim(),
        description: description.trim() || undefined,
      });
      setResult(res);

      // Persist the link so we can reference it later
      if (ticketKey) {
        setSecDeskLink(ticketKey, {
          issueKey: res.issueKey,
          url: res.url,
          createdAt: new Date().toISOString(),
        });

        // Best-effort follow-up operations: collect warnings for any failures
        const warnings: string[] = [];

        // Append to summary.md
        if (projectCwd) {
          await api.projects.readFile({ cwd: projectCwd, relativePath: "summary.md" }).then(
            async (existing) => {
              const append = `\n\n## SECDESK\n\n- **Ticket:** [${res.issueKey}](${res.url})\n- **Created:** ${new Date().toLocaleDateString()}\n- **Summary:** ${summary.trim()}\n`;
              await api.projects.writeFile({
                cwd: projectCwd,
                relativePath: "summary.md",
                contents: existing.contents + append,
              });
            },
          ).catch((err) => {
            const msg = "Failed to append SECDESK info to summary.md";
            console.warn(msg, err);
            warnings.push(msg);
          });
        }

        // Link back to original Jira ticket
        await api.jira.postComment({
          ticketKey,
          body: `SECDESK request created: ${res.issueKey} — ${res.url}`,
        }).catch((err) => {
          const msg = `Failed to post comment to ${ticketKey}`;
          console.warn(msg, err);
          warnings.push(msg);
        });

        // Show warnings to user if any follow-up operations failed
        if (warnings.length > 0) {
          toastManager.add({
            type: "warning",
            title: "SECDESK ticket created with warnings",
            description: warnings.join(". ") + ".",
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }, [selectedTypeId, summary, description, ticketKey, projectCwd, setSecDeskLink]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Create SECDESK Request</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {result ? (
            <div className="space-y-2">
              <p className="text-sm text-emerald-400">
                Created {result.issueKey}
              </p>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline"
              >
                View in Jira
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Request Type
                </label>
                <select
                  className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value)}
                >
                  {requestTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Summary
                </label>
                <input
                  className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Brief summary of the request"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  className="max-h-48 min-h-[6rem] w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details — accounts to close, justification, etc."
                />
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
          )}
        </DialogPanel>
        {!result && (
          <DialogFooter variant="bare">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={submitting || !summary.trim() || !selectedTypeId}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Creating..." : "Create Request"}
            </Button>
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
});
