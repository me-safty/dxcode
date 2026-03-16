import { type SubagentRun } from "@t3tools/contracts";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";

function statusLabel(status: SubagentRun["status"]): string {
  switch (status) {
    case "preparing":
      return "Preparing specialist";
    case "running":
      return "Running specialist";
    case "report_ready":
      return "Report ready";
    case "accepted":
      return "Report accepted";
    case "retained":
      return "Worktree retained";
    case "cleaned_up":
      return "Cleaned up";
    case "cleanup_failed":
      return "Cleanup failed";
    case "failed":
      return "Failed";
  }
}

export function SubagentReportCard(props: {
  run: SubagentRun;
  markdownCwd: string | undefined;
  onUseReport: (run: SubagentRun) => void;
  onOpenWorktreeThread: (run: SubagentRun) => void;
  onDiscard: (run: SubagentRun) => void;
}) {
  const canUseReport = props.run.report !== null;
  const canOpenWorktree = !!props.run.worktreePath && !!props.run.branch;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Specialist
          </p>
          <h3 className="font-medium text-sm">{props.run.skillTitle}</h3>
          <p className="mt-1 text-muted-foreground text-sm">{statusLabel(props.run.status)}</p>
        </div>
        <p className="max-w-[16rem] text-right text-muted-foreground text-xs">{props.run.task}</p>
      </div>
      {props.run.report ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm">{props.run.report.summary}</p>
          <div className="rounded-xl border border-border/50 bg-background/70 p-3">
            <ChatMarkdown text={props.run.report.markdown} cwd={props.markdownCwd} />
          </div>
        </div>
      ) : null}
      {props.run.lastError ? (
        <p className="mt-3 text-destructive text-sm">{props.run.lastError}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => props.onUseReport(props.run)}
          disabled={!canUseReport}
        >
          Use report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => props.onOpenWorktreeThread(props.run)}
          disabled={!canOpenWorktree}
        >
          Open worktree thread
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => props.onDiscard(props.run)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
