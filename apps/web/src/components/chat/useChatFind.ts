import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { resolveShortcutCommand } from "../../keybindings";
import { buildMatches, reconcileActiveMatch, type Match, type SearchOptions } from "./chatSearch";
import type { TimelineEntry } from "../../session-logic";

export interface ChatFindController {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  matches: ReadonlyArray<Match>;
  currentIndex: number;
  activeMatch: Match | null;
  setQuery: (value: string) => void;
  toggleCaseSensitive: () => void;
  next: () => void;
  prev: () => void;
  openFind: () => void;
  close: () => void;
}

export function useChatFind(params: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  keybindings: ResolvedKeybindingsConfig;
  isTerminalFocused: () => boolean;
  terminalOpen: boolean;
}): ChatFindController {
  const { timelineEntries, keybindings, isTerminalFocused, terminalOpen } = params;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  const deferredQuery = useDeferredValue(query);
  const opts = useMemo<SearchOptions>(() => ({ caseSensitive }), [caseSensitive]);
  const matches = useMemo(
    () => (open ? buildMatches(timelineEntries, deferredQuery, opts) : []),
    [open, timelineEntries, deferredQuery, opts],
  );

  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;

  // Re-anchor the active match when the set changes (typing / streaming).
  useEffect(() => {
    const next = reconcileActiveMatch(matches, activeMatchId, indexRef.current);
    setCurrentIndex(next);
    setActiveMatchId(matches[next]?.matchId ?? null);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps -- react to match-set identity only

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      setActiveMatchId(matches[index]?.matchId ?? null);
    },
    [matches],
  );

  const next = useCallback(() => {
    if (matches.length === 0) return;
    goTo((indexRef.current + 1) % matches.length);
  }, [matches, goTo]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    goTo((indexRef.current - 1 + matches.length) % matches.length);
  }, [matches, goTo]);

  const openFind = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveMatchId(null);
    setCurrentIndex(0);
  }, []);
  const toggleCaseSensitive = useCallback(() => setCaseSensitive((value) => !value), []);

  // Global Cmd/Ctrl+F listener (mirrors CommandPalette.tsx:382-400).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused(), terminalOpen },
      });
      if (command !== "find.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, terminalOpen, isTerminalFocused]);

  return {
    open,
    query,
    caseSensitive,
    matches,
    currentIndex,
    activeMatch: matches[currentIndex] ?? null,
    setQuery,
    toggleCaseSensitive,
    next,
    prev,
    openFind,
    close,
  };
}
