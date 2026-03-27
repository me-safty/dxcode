import { useCallback, useState } from "react";
import { ChevronDownIcon, PlayIcon, SearchIcon, UsersIcon } from "lucide-react";
import type { ThreadId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";

function sendToChat(command: string) {
  const text = command.replace(/\n$/, "");
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent("commandTraySubmit", { detail: { command: text } }),
  );
}

function DeepDiveDropdown({
  getChatText,
}: {
  getChatText: () => string;
}) {
  const [rounds, setRounds] = useState("2");

  const handleRun = useCallback(() => {
    const issue = getChatText().trim();
    if (!issue) return;
    const cmd = `please do ${rounds} rounds of a /dd into the following issue:\n\n${issue}`;
    sendToChat(cmd);
  }, [rounds, getChatText]);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            type="button"
          >
            <SearchIcon className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Deep Dive</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </Button>
        }
      />
      <MenuPopup side="top" align="start" sideOffset={8} className="w-64">
        <div
          className="space-y-2 p-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-medium text-foreground/80">Deep Dive</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Rounds:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={rounds}
              onChange={(e) => setRounds(e.target.value)}
              className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-center text-xs text-foreground outline-none focus:border-ring"
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Uses the text in the chat input as the issue description.
          </p>
          <button
            type="button"
            onClick={handleRun}
            className="flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlayIcon className="size-3" />
            Run Deep Dive
          </button>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function ScrumDropdown() {
  const [agents, setAgents] = useState("6");
  const [llm, setLlm] = useState<"codex" | "claude">("codex");

  const handleRun = useCallback(() => {
    const cmd = `please /scrum all the issues, using ${agents} ${llm} subagents`;
    sendToChat(cmd);
  }, [agents, llm]);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            type="button"
          >
            <UsersIcon className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Scrum</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </Button>
        }
      />
      <MenuPopup side="top" align="start" sideOffset={8} className="w-64">
        <div
          className="space-y-2 p-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-medium text-foreground/80">Scrum</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Agents:</span>
            <input
              type="number"
              min={1}
              max={20}
              value={agents}
              onChange={(e) => setAgents(e.target.value)}
              className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-center text-xs text-foreground outline-none focus:border-ring"
            />
            <span>LLM:</span>
            <select
              value={llm}
              onChange={(e) => setLlm(e.target.value as "codex" | "claude")}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-ring"
            >
              <option value="codex">codex</option>
              <option value="claude">claude</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleRun}
            className="flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlayIcon className="size-3" />
            Run Scrum
          </button>
        </div>
      </MenuPopup>
    </Menu>
  );
}

export default function WorkflowDropdowns({
  threadId,
  getChatText,
}: {
  threadId: ThreadId;
  getChatText: () => string;
}) {
  return (
    <>
      <DeepDiveDropdown getChatText={getChatText} />
      <ScrumDropdown />
    </>
  );
}
