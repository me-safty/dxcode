import {
  BotIcon,
  CircleAlertIcon,
  Globe2Icon,
  MessageCircleIcon,
  Settings2Icon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import type { VoiceTraceEntry } from "./voiceTraceStore";

function TraceIcon({ kind }: { readonly kind: VoiceTraceEntry["kind"] }) {
  const className = "size-3.5";
  switch (kind) {
    case "user":
      return <MessageCircleIcon className={className} />;
    case "assistant":
      return <BotIcon className={className} />;
    case "server_tool":
      return <Globe2Icon className={className} />;
    case "tool_call":
    case "tool_result":
      return <WrenchIcon className={className} />;
    case "error":
      return <CircleAlertIcon className={className} />;
    case "system":
      return <Settings2Icon className={className} />;
  }
}

export function VoiceTraceTimeline({
  entries,
  streamingUserText,
  streamingAssistantText,
  className,
}: {
  readonly entries: readonly VoiceTraceEntry[];
  readonly streamingUserText?: string | undefined;
  readonly streamingAssistantText?: string | undefined;
  readonly className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, streamingAssistantText, streamingUserText]);

  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 overflow-y-auto overscroll-contain", className)}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedToBottomRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      <div className="space-y-2 p-2.5">
        {entries.length === 0 && !streamingUserText && !streamingAssistantText ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Conversation and tool activity will appear here.
          </p>
        ) : null}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-xs",
              entry.kind === "error"
                ? "border-destructive/25 bg-destructive/5 text-destructive"
                : "border-border/55 bg-background/55",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <TraceIcon kind={entry.kind} />
              <span>{entry.title}</span>
              <time className="ml-auto font-normal text-[10px] text-muted-foreground">
                {new Date(entry.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            </div>
            {entry.text ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-foreground/75">
                {entry.text}
              </p>
            ) : null}
            {entry.details ? (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/45 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {entry.details}
              </pre>
            ) : null}
          </div>
        ))}
        {streamingUserText ? (
          <div className="rounded-lg border border-border/55 bg-background/55 px-2.5 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <MessageCircleIcon className="size-3.5" />
              You
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">Live</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-foreground/75">
              {streamingUserText}
            </p>
          </div>
        ) : null}
        {streamingAssistantText ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <BotIcon className="size-3.5" />
              Grok
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">Live</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-foreground/75">
              {streamingAssistantText}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
