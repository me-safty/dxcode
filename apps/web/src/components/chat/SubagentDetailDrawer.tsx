import {
  BotIcon,
  ClockIcon,
  EyeIcon,
  GlobeIcon,
  ListIcon,
  MessageSquareTextIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import {
  formatTokenCount,
  formatToolUseCount,
  type AgentProgressEntry,
  type AgentTaskSummary,
  type SubagentToolProgress,
} from "../../session-logic";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetPanel,
} from "../ui/sheet";
import ChatMarkdown from "../ChatMarkdown";
import { MessageCopyButton } from "./MessageCopyButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SubagentDetailDrawerProps {
  task: AgentTaskSummary | null;
  onClose: () => void;
  markdownCwd: string | undefined;
}

function statusLabel(status: AgentTaskSummary["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

function statusColor(status: AgentTaskSummary["status"]): string {
  switch (status) {
    case "running":
      return "text-amber-400";
    case "completed":
      return "text-emerald-500";
    case "failed":
      return "text-rose-400";
    case "stopped":
      return "text-muted-foreground";
  }
}

function statusDotColor(status: AgentTaskSummary["status"]): string {
  switch (status) {
    case "running":
      return "bg-amber-400/70";
    case "completed":
      return "bg-emerald-500/70";
    case "failed":
      return "bg-rose-400/70";
    case "stopped":
      return "bg-muted-foreground/40";
  }
}

function toolIconForName(toolName: string): ReactNode {
  const normalized = toolName.toLowerCase();
  const iconClass = "size-3 shrink-0";
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return <TerminalIcon className={iconClass} />;
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("notebookedit")
  ) {
    return <SquarePenIcon className={iconClass} />;
  }
  if (
    normalized.includes("read") ||
    normalized.includes("glob") ||
    normalized.includes("grep") ||
    normalized.includes("search") ||
    normalized.includes("view")
  ) {
    return <EyeIcon className={iconClass} />;
  }
  if (normalized.includes("web") || normalized.includes("fetch") || normalized.includes("browse")) {
    return <GlobeIcon className={iconClass} />;
  }
  if (normalized.includes("mcp")) {
    return <WrenchIcon className={iconClass} />;
  }
  if (normalized.includes("agent")) {
    return <BotIcon className={iconClass} />;
  }
  return <WrenchIcon className={iconClass} />;
}

function formatElapsedSeconds(seconds: number): string {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

type TimelineItem =
  | { kind: "tool-progress"; createdAt: string; data: SubagentToolProgress }
  | { kind: "task-progress"; createdAt: string; data: AgentProgressEntry };

function buildTimelineItems(task: AgentTaskSummary): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const entry of task.progressHistory) {
    items.push({ kind: "task-progress", createdAt: entry.createdAt, data: entry });
  }

  for (const entry of task.toolProgressEntries) {
    items.push({ kind: "tool-progress", createdAt: entry.createdAt, data: entry });
  }

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return items;
}

const ToolProgressTimelineRow = memo(function ToolProgressTimelineRow(props: {
  entry: SubagentToolProgress;
  isLast: boolean;
}) {
  const { entry, isLast } = props;
  return (
    <div className="relative flex gap-3 pb-1">
      <div className="flex w-4 flex-col items-center">
        <div className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground/70">
          {toolIconForName(entry.toolName)}
        </div>
        {!isLast && <div className="mt-1 min-h-2 flex-1 border-l border-border/30" />}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex min-w-0 flex-1 items-baseline gap-2 pt-0.5">
              <span className="text-xs text-foreground/70">{entry.toolName}</span>
              {entry.elapsedSeconds !== null && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/40">
                  {formatElapsedSeconds(entry.elapsedSeconds)}
                </span>
              )}
            </div>
          }
        />
        <TooltipPopup side="top" className="max-w-lg break-words whitespace-pre-wrap leading-tight">
          {entry.toolName}
          {entry.elapsedSeconds !== null ? ` (${formatElapsedSeconds(entry.elapsedSeconds)})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

const TaskProgressTimelineRow = memo(function TaskProgressTimelineRow(props: {
  entry: AgentProgressEntry;
  isLast: boolean;
}) {
  const { entry, isLast } = props;
  const toolLabel =
    entry.description ?? (entry.lastToolName ? `Using ${entry.lastToolName}` : null);
  if (!toolLabel) return null;

  const tooltipText =
    entry.summary && entry.summary !== entry.description
      ? `${toolLabel}\n${entry.summary}`
      : toolLabel;

  return (
    <div className="relative flex gap-3 pb-1">
      <div className="flex w-4 flex-col items-center">
        <div className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-400/70">
          {entry.lastToolName ? (
            toolIconForName(entry.lastToolName)
          ) : (
            <ClockIcon className="size-3 shrink-0" />
          )}
        </div>
        {!isLast && <div className="mt-1 min-h-2 flex-1 border-l border-border/30" />}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs text-foreground/60">{toolLabel}</p>
              {entry.summary && entry.summary !== entry.description && (
                <p className="mt-0.5 text-[10px] text-muted-foreground/50 italic">
                  {entry.summary}
                </p>
              )}
            </div>
          }
        />
        <TooltipPopup side="top" className="max-w-lg break-words whitespace-pre-wrap leading-tight">
          {tooltipText}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

const ProgressTimeline = memo(function ProgressTimeline(props: { task: AgentTaskSummary }) {
  const { task } = props;
  const items = useMemo(() => buildTimelineItems(task), [task]);

  if (items.length === 0) {
    return (
      <Section label="Activity" icon={<ListIcon className="size-3.5" />}>
        <p className="text-xs text-muted-foreground/50 italic">
          {task.status === "running" ? "Starting..." : "No activity recorded"}
        </p>
      </Section>
    );
  }

  return (
    <Section label="Activity" icon={<ListIcon className="size-3.5" />}>
      <div className="pl-0.5">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          if (item.kind === "tool-progress") {
            return (
              <ToolProgressTimelineRow
                key={`t-${item.data.toolName}-${item.createdAt}`}
                entry={item.data}
                isLast={isLast}
              />
            );
          }
          return (
            <TaskProgressTimelineRow
              key={`p-${item.createdAt}`}
              entry={item.data}
              isLast={isLast}
            />
          );
        })}
        {task.status === "running" && (
          <div className="relative flex gap-3">
            <div className="flex w-4 items-center justify-center">
              <span className="size-2 animate-pulse rounded-full bg-amber-400/70" />
            </div>
            <span className="pt-0.5 text-[10px] text-amber-400/60">Working...</span>
          </div>
        )}
      </div>
    </Section>
  );
});

const PromptSection = memo(function PromptSection(props: {
  prompt: string;
  markdownCwd: string | undefined;
}) {
  return (
    <Section
      label="Prompt"
      icon={<MessageSquareTextIcon className="size-3.5" />}
      copyText={props.prompt}
    >
      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <ChatMarkdown text={props.prompt} cwd={props.markdownCwd} />
      </div>
    </Section>
  );
});

const ResponseSection = memo(function ResponseSection(props: {
  response: string | null;
  status: AgentTaskSummary["status"];
  markdownCwd: string | undefined;
}) {
  const { response, status, markdownCwd } = props;

  if (status === "running") {
    return (
      <Section label="Response" icon={<MessageSquareTextIcon className="size-3.5" />}>
        <div className="flex items-center gap-2 text-xs text-amber-400/70">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-400/70" />
          In progress...
        </div>
      </Section>
    );
  }

  if (status === "failed") {
    return (
      <Section
        label="Response"
        icon={<MessageSquareTextIcon className="size-3.5" />}
        {...(response ? { copyText: response } : {})}
      >
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <ChatMarkdown text={response ?? "Task failed"} cwd={markdownCwd} />
        </div>
      </Section>
    );
  }

  if (!response) {
    return (
      <Section label="Response" icon={<MessageSquareTextIcon className="size-3.5" />}>
        <p className="text-xs text-muted-foreground/50 italic">No response recorded</p>
      </Section>
    );
  }

  return (
    <Section
      label="Response"
      icon={<MessageSquareTextIcon className="size-3.5" />}
      copyText={response}
    >
      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <ChatMarkdown text={response} cwd={markdownCwd} />
      </div>
    </Section>
  );
});

function Section(props: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  copyText?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70">
        {props.icon}
        <span className="flex-1">{props.label}</span>
        {props.copyText && <MessageCopyButton text={props.copyText} />}
      </div>
      {props.children}
    </div>
  );
}

function DrawerHeader(props: { task: AgentTaskSummary }) {
  const { task } = props;
  const meta: string[] = [];
  if (task.toolUses !== null) meta.push(formatToolUseCount(task.toolUses));
  if (task.totalTokens !== null) meta.push(formatTokenCount(task.totalTokens));

  return (
    <SheetHeader className="gap-1.5 border-b border-border/40 pb-4">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 shrink-0 text-violet-400/70" />
        <SheetTitle className="min-w-0 flex-1 truncate text-sm">{task.description}</SheetTitle>
      </div>
      <SheetDescription className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            task.status === "running" && "animate-pulse",
            statusDotColor(task.status),
          )}
        />
        <span className={statusColor(task.status)}>{statusLabel(task.status)}</span>
        {task.agentType && (
          <span className="rounded bg-muted/50 px-1 py-px text-[10px] text-muted-foreground/60">
            {task.agentType}
          </span>
        )}
        {task.model && (
          <span className="rounded bg-muted/50 px-1 py-px text-[10px] text-muted-foreground/60">
            {task.model}
          </span>
        )}
        {meta.length > 0 && <span className="text-muted-foreground/40">{meta.join(" · ")}</span>}
      </SheetDescription>
    </SheetHeader>
  );
}

export const SubagentDetailDrawer = memo(function SubagentDetailDrawer(
  props: SubagentDetailDrawerProps,
) {
  const { task, onClose, markdownCwd } = props;

  return (
    <Sheet
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="w-[min(88vw,600px)] max-w-[600px]"
      >
        {task && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="absolute end-2 top-2 z-10"
              onClick={onClose}
            >
              <XIcon />
            </Button>
            <DrawerHeader task={task} />
            <SheetPanel>
              <div className="space-y-6">
                {task.prompt && <PromptSection prompt={task.prompt} markdownCwd={markdownCwd} />}
                <ProgressTimeline task={task} />
                <ResponseSection
                  response={task.response}
                  status={task.status}
                  markdownCwd={markdownCwd}
                />
              </div>
            </SheetPanel>
          </>
        )}
      </SheetPopup>
    </Sheet>
  );
});
