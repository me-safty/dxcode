import { memo, useCallback, useEffect, useRef, useState } from "react";
import { type LegendListRef } from "@legendapp/list/react";

import { cn } from "~/lib/utils";
import { PreviewCard, PreviewCardTrigger } from "~/components/ui/preview-card";
import { computeActiveMinimapIndex, type MinimapUserMessageEntry } from "./ChatMinimap.logic";

interface ChatMinimapProps {
  listRef: React.RefObject<LegendListRef | null>;
  entries: ReadonlyArray<MinimapUserMessageEntry>;
  threadKey: string;
}

const EXPAND_DELAY_MS = 60;
const COLLAPSE_DELAY_MS = 150;

const displayPreviewText = (entry: MinimapUserMessageEntry) =>
  entry.previewText.trim() || "(empty message)";

export const ChatMinimap = memo(function ChatMinimap({
  listRef,
  entries,
  threadKey,
}: ChatMinimapProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Reset active highlight + collapse the menu on thread switch so a stale
  // index or an open menu doesn't flash against the freshly-loaded thread.
  useEffect(() => {
    setActiveIndex(null);
    setIsOpen(false);
  }, [threadKey]);

  // Active-dash tracking (event-driven)
  useEffect(() => {
    if (entries.length === 0) return;
    const list = listRef.current;
    if (!list) return;

    const recompute = () => {
      const state = list.getState?.();
      if (!state) return;
      const next = computeActiveMinimapIndex(state, entries);
      if (next === undefined) return; // not measured yet
      setActiveIndex((prev) => (prev === next ? prev : next));
    };

    const scrollNode = list.getScrollableNode?.() ?? null;
    scrollNode?.addEventListener("scroll", recompute, { passive: true });
    // `listen` lives on the state object, not the ref itself. Payload is a
    // timestamp we don't need — we just want a pulse on each remeasure.
    const unsubscribe = list.getState?.()?.listen?.("lastPositionUpdate", () => {
      recompute();
    });

    recompute();

    return () => {
      scrollNode?.removeEventListener("scroll", recompute);
      unsubscribe?.();
    };
  }, [listRef, entries, threadKey]);

  // When the menu opens, scroll the active row into view so a long
  // conversation doesn't require the user to hunt for the current position.
  useEffect(() => {
    if (!isOpen) return;
    if (activeButtonRef.current) {
      activeButtonRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [isOpen, activeIndex]);

  const navigate = useCallback(
    (entry: MinimapUserMessageEntry) => {
      void listRef.current?.scrollToIndex?.({
        index: entry.rowIndex,
        animated: true,
        viewPosition: 0.08,
      });
      setIsOpen(false);
    },
    [listRef],
  );

  if (entries.length === 0) return null;

  return (
    <PreviewCard open={isOpen} onOpenChange={setIsOpen}>
      <nav
        aria-label="User messages minimap"
        className="pointer-events-none absolute top-3 right-1 sm:right-2 z-20 flex max-h-[calc(100%-1.5rem)] flex-col items-end"
        data-testid="chat-minimap"
        data-expanded={isOpen ? "true" : undefined}
      >
        <PreviewCardTrigger
          className="pointer-events-auto"
          closeDelay={COLLAPSE_DELAY_MS}
          delay={EXPAND_DELAY_MS}
          render={<div />}
        >
          {isOpen ? (
            <ExpandedMenu
              entries={entries}
              activeIndex={activeIndex}
              onNavigate={navigate}
              activeButtonRef={activeButtonRef}
            />
          ) : (
            <DashesStrip entries={entries} activeIndex={activeIndex} />
          )}
        </PreviewCardTrigger>
      </nav>
    </PreviewCard>
  );
});

/**
 * Collapsed view — thin vertical strip of dashes.
 */
function DashesStrip({
  entries,
  activeIndex,
}: {
  entries: ReadonlyArray<MinimapUserMessageEntry>;
  activeIndex: number | null;
}) {
  return (
    <ul
      className="flex max-h-full flex-col items-end gap-1 sm:gap-1.5 overflow-y-auto rounded-md px-1 sm:px-1.5 py-1"
      data-testid="chat-minimap-list"
    >
      {entries.map((entry, index) => {
        const isActive = activeIndex === index;
        return (
          <li key={entry.rowKey} className="flex justify-end">
            <button
              type="button"
              data-testid="chat-minimap-dash"
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "h-0.75 w-4 cursor-pointer rounded-full transition-[background-color,width] duration-150 hover:w-5 hover:bg-foreground sm:hover:w-7",
                isActive ? "bg-foreground" : "bg-foreground/10",
              )}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Expanded view — dropdown-style list of message previews. Opens on hover
 */
function ExpandedMenu({
  entries,
  activeIndex,
  onNavigate,
  activeButtonRef,
}: {
  entries: ReadonlyArray<MinimapUserMessageEntry>;
  activeIndex: number | null;
  onNavigate: (entry: MinimapUserMessageEntry) => void;
  activeButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      className="mr-3 flex h-[min(60vh,24rem)] min-w-45 max-w-88 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg not-dark:bg-clip-padding"
      data-testid="chat-minimap-menu"
    >
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5">
        {entries.map((entry, index) => {
          const isActive = activeIndex === index;
          const preview = displayPreviewText(entry);
          return (
            <li key={entry.rowKey}>
              <button
                type="button"
                data-testid="chat-minimap-menu-item"
                data-active={isActive ? "true" : undefined}
                data-message-id={entry.messageId}
                aria-current={isActive ? "true" : undefined}
                ref={isActive ? activeButtonRef : null}
                onClick={() => onNavigate(entry)}
                className={cn(
                  "w-full cursor-pointer rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  isActive ? "bg-muted/70 text-foreground" : "text-foreground/75",
                )}
              >
                <span className="block truncate">{preview}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
