import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCopyIcon, CheckIcon } from "lucide-react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useStore } from "~/store";
import { useProjectStatusStore } from "~/projectStatusStore";
import type { Project } from "~/types";

interface StandupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProjectEntry {
  project: Project;
  included: boolean;
  note: string;
}

type Step = "select" | "edit";

export const StandupModal = memo(function StandupModal({
  open,
  onOpenChange,
}: StandupModalProps) {
  const { projects } = useStore();
  const waitingProjectIds = useProjectStatusStore((s) => s.waitingProjectIds);

  const [step, setStep] = useState<Step>("select");
  const [entries, setEntries] = useState<ProjectEntry[]>([]);
  const [yesterdayNotes, setYesterdayNotes] = useState("");
  const [blockerNotes, setBlockerNotes] = useState("");
  const [standupText, setStandupText] = useState("");
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (!open) return;
    setStep("select");
    setCopied(false);
    setYesterdayNotes("");
    setBlockerNotes("");
    setStandupText("");
    setEntries(
      projects.map((p) => ({
        project: p,
        included: true,
        note: "",
      })),
    );
  }, [open, projects]);

  const activeEntries = useMemo(
    () => entries.filter((e) => !waitingProjectIds.has(e.project.id)),
    [entries, waitingProjectIds],
  );
  const waitingEntries = useMemo(
    () => entries.filter((e) => waitingProjectIds.has(e.project.id)),
    [entries, waitingProjectIds],
  );

  const toggleIncluded = useCallback((projectId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.project.id === projectId ? { ...e, included: !e.included } : e,
      ),
    );
  }, []);

  const updateNote = useCallback((projectId: string, note: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.project.id === projectId ? { ...e, note } : e,
      ),
    );
  }, []);

  const generateStandup = useCallback(() => {
    const included = entries.filter((e) => e.included);
    const active = included.filter((e) => !waitingProjectIds.has(e.project.id));
    const waiting = included.filter((e) => waitingProjectIds.has(e.project.id));

    const lines: string[] = [];

    // Yesterday
    lines.push("*Yesterday:*");
    if (yesterdayNotes.trim()) {
      for (const line of yesterdayNotes.trim().split("\n")) {
        lines.push(`• ${line}`);
      }
    }
    for (const entry of active) {
      const p = entry.project;
      const key = p.ticketKey ? `${p.ticketKey}: ` : "";
      const status = p.jiraStatus ? ` [${p.jiraStatus}]` : "";
      const note = entry.note.trim() ? ` — ${entry.note.trim()}` : "";
      lines.push(`• ${key}${p.name}${status}${note}`);
    }
    if (active.length === 0 && !yesterdayNotes.trim()) {
      lines.push("• (no updates)");
    }
    lines.push("");

    // Today
    lines.push("*Today:*");
    for (const entry of active) {
      const p = entry.project;
      const key = p.ticketKey ? `${p.ticketKey}: ` : "";
      lines.push(`• ${key}${p.name}`);
    }
    if (active.length === 0) {
      lines.push("• (planning)");
    }
    lines.push("");

    // Blockers
    lines.push("*Blockers:*");
    if (blockerNotes.trim()) {
      for (const line of blockerNotes.trim().split("\n")) {
        lines.push(`• ${line}`);
      }
    }
    if (waiting.length > 0) {
      for (const entry of waiting) {
        const p = entry.project;
        const key = p.ticketKey ? `${p.ticketKey}: ` : "";
        const note = entry.note.trim() ? ` — ${entry.note.trim()}` : " — waiting";
        lines.push(`• ${key}${p.name}${note}`);
      }
    }
    if (waiting.length === 0 && !blockerNotes.trim()) {
      lines.push("• None");
    }

    setStandupText(lines.join("\n"));
    setStep("edit");
  }, [entries, waitingProjectIds, yesterdayNotes, blockerNotes]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(standupText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [standupText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {step === "select" ? "Daily Standup" : "Edit & Copy"}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {step === "select" ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Yesterday freeform */}
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Yesterday (additional notes)
                </label>
                <textarea
                  className="min-h-[3rem] w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  value={yesterdayNotes}
                  onChange={(e) => setYesterdayNotes(e.target.value)}
                  placeholder="Meetings attended, ad-hoc work, etc."
                />
              </div>

              {/* Active projects */}
              {activeEntries.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    Active Projects
                  </div>
                  <div className="space-y-2">
                    {activeEntries.map((entry) => (
                      <ProjectRow
                        key={entry.project.id}
                        entry={entry}
                        onToggle={toggleIncluded}
                        onNote={updateNote}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Waiting projects */}
              {waitingEntries.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    Waiting / Blocked
                  </div>
                  <div className="space-y-2">
                    {waitingEntries.map((entry) => (
                      <ProjectRow
                        key={entry.project.id}
                        entry={entry}
                        onToggle={toggleIncluded}
                        onNote={updateNote}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Blockers freeform */}
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Blockers (additional notes)
                </label>
                <textarea
                  className="min-h-[3rem] w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  value={blockerNotes}
                  onChange={(e) => setBlockerNotes(e.target.value)}
                  placeholder="Anything blocking progress..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                className="min-h-[12rem] w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground font-mono leading-relaxed focus:border-ring focus:outline-none"
                value={standupText}
                onChange={(e) => setStandupText(e.target.value)}
              />
            </div>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          {step === "select" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={generateStandup}>
                Generate
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStep("select")}
              >
                Back
              </Button>
              <Button
                size="sm"
                variant={copied ? "default" : "outline"}
                onClick={() => void handleCopy()}
                className="gap-1.5"
              >
                {copied ? (
                  <>
                    <CheckIcon className="size-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <ClipboardCopyIcon className="size-3.5" />
                    Copy to Clipboard
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
});

function ProjectRow({
  entry,
  onToggle,
  onNote,
}: {
  entry: ProjectEntry;
  onToggle: (id: string) => void;
  onNote: (id: string, note: string) => void;
}) {
  const p = entry.project;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/50 bg-secondary/30 px-2 py-1.5">
      <input
        type="checkbox"
        checked={entry.included}
        onChange={() => onToggle(p.id)}
        className="mt-0.5 size-3.5 rounded border-border accent-primary"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs">
          {p.ticketKey && (
            <span className="shrink-0 font-medium text-muted-foreground">
              {p.ticketKey}
            </span>
          )}
          <span className="truncate text-foreground/90">{p.name}</span>
          {p.jiraStatus && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              {p.jiraStatus}
            </span>
          )}
        </div>
        {entry.included && (
          <input
            type="text"
            value={entry.note}
            onChange={(e) => onNote(p.id, e.target.value)}
            placeholder="Add note..."
            className="mt-1 w-full rounded border-none bg-transparent px-0 py-0 text-[11px] text-foreground/70 placeholder:text-muted-foreground/30 focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
