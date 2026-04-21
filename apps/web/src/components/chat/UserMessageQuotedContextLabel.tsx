import { ChevronDownIcon, CornerDownRightIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { ParsedQuotedContextEntry } from "../../lib/quotedContext";

type EntryKind = "text" | "code" | "diff";

function classifyEntry(entry: ParsedQuotedContextEntry): EntryKind {
  if (entry.header.startsWith("Quoted diff")) return "diff";
  if (entry.header.startsWith("Quoted code")) return "code";
  return "text";
}

function QuotedContextEntry({ ctx, panelId }: { ctx: ParsedQuotedContextEntry; panelId: string }) {
  const kind = classifyEntry(ctx);
  const isDiff = kind === "diff";
  const isMonospace = kind !== "text";
  const hasBody = Boolean(ctx.body);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || isExpanded) return;

    const measure = () => {
      setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ctx.body, isExpanded, isMonospace]);

  const canToggle = hasBody && (isOverflowing || isExpanded);

  const containerClass = cn(
    "rounded-md rounded-l-none border-l-2 transition-colors",
    isDiff
      ? "border-emerald-400/70 bg-emerald-500/8 hover:bg-emerald-500/12 dark:border-emerald-400/70 dark:bg-emerald-400/8 dark:hover:bg-emerald-400/12"
      : "border-violet-400/70 bg-violet-500/8 hover:bg-violet-500/12 dark:border-violet-400/70 dark:bg-violet-400/8 dark:hover:bg-violet-400/12",
  );

  const headerClass = cn(
    "flex w-full items-center gap-1.5 rounded-md rounded-l-none px-2.5 py-1.5 text-left text-xs font-medium",
    isDiff ? "text-emerald-700 dark:text-emerald-300" : "text-violet-700 dark:text-violet-300",
  );

  const headerInner = (
    <>
      <CornerDownRightIcon className="size-3 shrink-0 opacity-80" />
      <span className="truncate">{ctx.header}</span>
      {canToggle && (
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3 shrink-0 opacity-70 transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      )}
    </>
  );

  return (
    <div className={containerClass}>
      {canToggle ? (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className={cn(
            headerClass,
            "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          {headerInner}
        </button>
      ) : (
        <div className={headerClass}>{headerInner}</div>
      )}
      {hasBody && (
        <div
          id={panelId}
          role="region"
          aria-label={`Quoted content: ${ctx.header}`}
          className="px-2.5 pb-1.5"
        >
          <div
            ref={bodyRef}
            className={cn(
              "whitespace-pre-wrap break-words text-xs text-muted-foreground",
              isMonospace && "font-mono",
              !isExpanded && (isMonospace ? "line-clamp-3" : "line-clamp-2"),
            )}
          >
            {ctx.body}
          </div>
        </div>
      )}
    </div>
  );
}

export function UserMessageQuotedContextLabel({
  contexts,
}: {
  contexts: ReadonlyArray<ParsedQuotedContextEntry>;
}) {
  const baseId = useId();

  if (contexts.length === 0) return null;

  return (
    <div className="mb-1.5 space-y-1.5">
      {contexts.map((ctx, idx) => (
        <QuotedContextEntry
          key={ctx.header + String(idx)}
          ctx={ctx}
          panelId={`${baseId}-quote-${idx}`}
        />
      ))}
    </div>
  );
}
