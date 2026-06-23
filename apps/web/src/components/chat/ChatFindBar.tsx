import { useEffect, useRef } from "react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import type { ChatFindController } from "./useChatFind";

export function ChatFindBar({ controller }: { controller: ChatFindController }) {
  const { open, query, caseSensitive, matches, currentIndex } = controller;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const total = matches.length;
  const countLabel = total === 0 ? (query ? "No results" : "") : `${currentIndex + 1}/${total}`;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return; // IME guard
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) controller.prev();
      else controller.next();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      controller.close();
    }
  };

  return (
    <div
      className="absolute right-4 top-3 z-50 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1 text-popover-foreground shadow-lg/5"
      role="search"
    >
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/65" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => controller.setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        className="w-48 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
      <span
        aria-live="polite"
        className={cn(
          "min-w-12 select-none text-right text-xs tabular-nums",
          total === 0 && query ? "text-destructive" : "text-muted-foreground/65",
        )}
      >
        {countLabel}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={total === 0}
        onClick={controller.prev}
        className="flex size-6 items-center justify-center rounded-md hover:bg-accent/20 disabled:opacity-40"
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={total === 0}
        onClick={controller.next}
        className="flex size-6 items-center justify-center rounded-md hover:bg-accent/20 disabled:opacity-40"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={controller.toggleCaseSensitive}
        className={cn(
          "flex size-6 items-center justify-center rounded-md text-xs font-medium hover:bg-accent/20",
          caseSensitive ? "bg-accent/30 text-foreground" : "text-muted-foreground/65",
        )}
      >
        Aa
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={controller.close}
        className="flex size-6 items-center justify-center rounded-md hover:bg-accent/20"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
