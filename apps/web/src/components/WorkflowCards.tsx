import { useCallback, useState } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { PlayIcon, ChevronRightIcon } from "lucide-react";

interface WorkflowCardsProps {
  threadId: ThreadId | null;
}

function sendToChat(command: string) {
  const text = command.replace(/\n$/, "");
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent("commandTraySubmit", { detail: { command: text } }),
  );
}

function DeepDiveCard({ threadId }: { threadId: ThreadId | null }) {
  const [rounds, setRounds] = useState("2");
  const [issue, setIssue] = useState("");

  const handleSubmit = useCallback(() => {
    if (!threadId || !issue.trim()) return;
    const cmd = `please do ${rounds} rounds of a /dd into the following issue:\n\n${issue.trim()}`;
    sendToChat(cmd);
  }, [threadId, rounds, issue]);

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5">
      <div className="mb-2 text-[11px] font-medium text-foreground/80">Deep Dive</div>
      <div className="text-[11px] leading-relaxed text-muted-foreground">
        <span>please do </span>
        <input
          type="number"
          min={1}
          max={10}
          value={rounds}
          onChange={(e) => setRounds(e.target.value)}
          className="inline-block w-8 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground outline-none focus:border-ring"
        />
        <span> rounds of a /dd into the following issue:</span>
      </div>
      <textarea
        value={issue}
        onChange={(e) => setIssue(e.target.value)}
        placeholder="Type your issue here..."
        rows={3}
        className="mt-1.5 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!threadId || !issue.trim()}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <PlayIcon className="size-3" />
        Run Deep Dive
      </button>
    </div>
  );
}

function ScrumCard({ threadId }: { threadId: ThreadId | null }) {
  const [agents, setAgents] = useState("6");
  const [llm, setLlm] = useState<"codex" | "claude">("codex");

  const handleSubmit = useCallback(() => {
    if (!threadId) return;
    const cmd = `please /scrum all the issues, using ${agents} ${llm} subagents`;
    sendToChat(cmd);
  }, [threadId, agents, llm]);

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5">
      <div className="mb-2 text-[11px] font-medium text-foreground/80">Scrum</div>
      <div className="text-[11px] leading-relaxed text-muted-foreground">
        <span>please /scrum all the issues, using </span>
        <input
          type="number"
          min={1}
          max={20}
          value={agents}
          onChange={(e) => setAgents(e.target.value)}
          className="inline-block w-8 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground outline-none focus:border-ring"
        />
        <span> </span>
        <select
          value={llm}
          onChange={(e) => setLlm(e.target.value as "codex" | "claude")}
          className="inline-block rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground outline-none focus:border-ring"
        >
          <option value="codex">codex</option>
          <option value="claude">claude</option>
        </select>
        <span> subagents</span>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!threadId}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <PlayIcon className="size-3" />
        Run Scrum
      </button>
    </div>
  );
}

export default function WorkflowCards({ threadId }: WorkflowCardsProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        Workflows
      </button>
      {expanded && (
        <div className="space-y-2">
          <DeepDiveCard threadId={threadId} />
          <ScrumCard threadId={threadId} />
        </div>
      )}
    </div>
  );
}
