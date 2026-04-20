import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { ArrowLeftIcon, CornerLeftUpIcon, FolderIcon, SearchIcon } from "lucide-react";

import type { EnvironmentId, ProjectEntry } from "@marcode/contracts";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Kbd, KbdGroup } from "../ui/kbd";
import { projectBrowseDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { readLocalApi } from "~/localApi";
import { basenameOfPath } from "~/vscode-icons";
import { cn, isMacPlatform } from "~/lib/utils";

const FILTER_DEBOUNCE_MS = 120;
const HOME_PREFIX_REGEX = /^\/Users\/[^/]+|^\/home\/[^/]+/;

interface DirectoryBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId | null;
  initialPath: string;
  title: string;
  confirmLabel: string;
  onConfirm: (absolutePath: string) => void | Promise<void>;
  allowNativePicker?: boolean;
}

function normalizeTrailingSlash(value: string): string {
  if (value.length <= 1) return value;
  return value.replace(/\/+$/, "");
}

function joinPath(parent: string, child: string): string {
  const cleanParent = normalizeTrailingSlash(parent);
  const cleanChild = child.replace(/^\/+/, "");
  if (cleanParent === "") return `/${cleanChild}`;
  return `${cleanParent}/${cleanChild}`;
}

function parentOfPath(absolutePath: string): string | null {
  const normalized = normalizeTrailingSlash(absolutePath);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return null;
  if (lastSlash === 0) return normalized === "/" ? null : "/";
  return normalized.slice(0, lastSlash);
}

function formatDisplayPath(absolutePath: string): string {
  if (!absolutePath) return "/";
  const withHome = absolutePath.replace(HOME_PREFIX_REGEX, "~");
  return withHome.endsWith("/") ? withHome : `${withHome}/`;
}

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  environmentId,
  initialPath,
  title,
  confirmLabel,
  onConfirm,
  allowNativePicker = true,
}: DirectoryBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [filterInput, setFilterInput] = useState("");
  const [debouncedFilter] = useDebouncedValue(filterInput, { wait: FILTER_DEBOUNCE_MS });
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isConfirming, setIsConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCurrentPath(initialPath);
      setFilterInput("");
      setHighlightedIndex(-1);
      setIsConfirming(false);
    }
  }, [open, initialPath]);

  const browseQuery = useQuery(
    projectBrowseDirectoriesQueryOptions({
      environmentId,
      cwd: currentPath,
      pathQuery: "",
      enabled: open && environmentId !== null && currentPath.length > 0,
    }),
  );

  const entries = browseQuery.data?.entries;
  const resolvedParent = browseQuery.data?.resolvedParent ?? "";
  const activePath = resolvedParent || currentPath;

  const filteredEntries = useMemo<ProjectEntry[]>(() => {
    if (!entries) return [];
    const lower = debouncedFilter.trim().toLowerCase();
    const showHidden = lower.startsWith(".");
    return entries.filter((entry) => {
      const name = basenameOfPath(entry.path).toLowerCase();
      if (!showHidden && name.startsWith(".")) return false;
      if (lower.length === 0) return true;
      return name.includes(lower);
    });
  }, [entries, debouncedFilter]);

  const canGoUp = useMemo(() => parentOfPath(activePath) !== null, [activePath]);
  const parentEntryOffset = canGoUp ? 1 : 0;

  useEffect(() => {
    setHighlightedIndex(filteredEntries.length > 0 ? parentEntryOffset : -1);
  }, [filteredEntries, parentEntryOffset]);

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const navigateInto = useCallback(
    (entry: ProjectEntry) => {
      const name = basenameOfPath(entry.path);
      setCurrentPath(joinPath(activePath, name));
      setFilterInput("");
      filterInputRef.current?.focus();
    },
    [activePath],
  );

  const goUp = useCallback(() => {
    const parent = parentOfPath(activePath);
    if (parent !== null) {
      setCurrentPath(parent);
      setFilterInput("");
    }
  }, [activePath]);

  const handleConfirm = useCallback(
    async (absolutePath: string) => {
      if (!absolutePath || isConfirming) return;
      setIsConfirming(true);
      try {
        await onConfirm(absolutePath);
        onOpenChange(false);
      } finally {
        setIsConfirming(false);
      }
    },
    [onConfirm, onOpenChange, isConfirming],
  );

  const handleNativePicker = useCallback(async () => {
    const api = readLocalApi();
    if (!api) return;
    let picked: string | null = null;
    try {
      picked = await api.dialogs.pickFolder();
    } catch {
      return;
    }
    if (picked) {
      await handleConfirm(picked);
    }
  }, [handleConfirm]);

  const totalListItems = parentEntryOffset + filteredEntries.length;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        if (totalListItems === 0) return;
        event.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % totalListItems);
      } else if (event.key === "ArrowUp") {
        if (totalListItems === 0) return;
        event.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? totalListItems - 1 : prev - 1));
      } else if (event.key === "Enter") {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          void handleConfirm(activePath);
          return;
        }
        if (canGoUp && highlightedIndex === 0) {
          event.preventDefault();
          goUp();
          return;
        }
        const entryIndex = highlightedIndex - parentEntryOffset;
        if (entryIndex >= 0 && filteredEntries[entryIndex]) {
          event.preventDefault();
          navigateInto(filteredEntries[entryIndex]);
        }
      } else if (event.key === "Backspace" && filterInput === "" && canGoUp) {
        event.preventDefault();
        goUp();
      }
    },
    [
      totalListItems,
      filteredEntries,
      highlightedIndex,
      parentEntryOffset,
      navigateInto,
      handleConfirm,
      activePath,
      filterInput,
      canGoUp,
      goUp,
    ],
  );

  const canConfirm = activePath.length > 0 && !isConfirming;
  const isDesktop = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const isMac = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;
  const modKeyLabel = isMac ? "⌘" : "Ctrl";
  const finderLabel = isMac ? "Open in Finder" : "Open in Explorer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-xl gap-0 p-0 overflow-hidden"
        showCloseButton={false}
        aria-label={title}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <button
            type="button"
            onClick={goUp}
            disabled={!canGoUp}
            aria-label="Go up one directory"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <div className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
            {formatDisplayPath(activePath)}
          </div>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => void handleConfirm(activePath)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span>{isConfirming ? "Adding…" : confirmLabel}</span>
            <KbdGroup className="text-muted-foreground">
              <Kbd>{modKeyLabel}</Kbd>
              <Kbd>↵</Kbd>
            </KbdGroup>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
          <div className="relative px-4 pt-3 pb-2">
            <SearchIcon className="absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              ref={filterInputRef}
              type="text"
              className="w-full rounded-md border border-transparent bg-transparent py-1 pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-border/60 focus:bg-secondary/40"
              placeholder="Filter folders…"
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              autoFocus
            />
          </div>

          <div className="px-4 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Directories
          </div>

          <div ref={listRef} className="flex max-h-80 min-h-48 flex-col overflow-y-auto px-2 pb-2">
            {canGoUp && (
              <button
                type="button"
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm",
                  highlightedIndex === 0
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onMouseEnter={() => setHighlightedIndex(0)}
                onClick={goUp}
                onDoubleClick={goUp}
              >
                <CornerLeftUpIcon className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">..</span>
              </button>
            )}
            {browseQuery.isFetching && (entries?.length ?? 0) === 0 ? (
              <span className="px-3 py-6 text-center text-muted-foreground text-xs">Loading…</span>
            ) : filteredEntries.length === 0 && !canGoUp ? (
              <span className="px-3 py-6 text-center text-muted-foreground text-xs">
                {browseQuery.isError
                  ? "Unable to read this directory."
                  : (entries?.length ?? 0) === 0
                    ? "This directory is empty or inaccessible."
                    : "No folders match the filter."}
              </span>
            ) : filteredEntries.length === 0 ? null : (
              filteredEntries.map((entry, index) => {
                const listIndex = index + parentEntryOffset;
                const isHighlighted = listIndex === highlightedIndex;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm",
                      isHighlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                    onMouseEnter={() => setHighlightedIndex(listIndex)}
                    onClick={() => navigateInto(entry)}
                    onDoubleClick={() => navigateInto(entry)}
                  >
                    <FolderIcon className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {basenameOfPath(entry.path) || entry.path}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4 overflow-x-auto">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="ml-1">Navigate</span>
            </KbdGroup>
            <KbdGroup>
              <Kbd>⌫</Kbd>
              <span className="ml-1">Back</span>
            </KbdGroup>
            <KbdGroup>
              <Kbd>Esc</Kbd>
              <span className="ml-1">Close</span>
            </KbdGroup>
          </div>
          {allowNativePicker && isDesktop ? (
            <button
              type="button"
              onClick={() => void handleNativePicker()}
              className="shrink-0 rounded px-1 text-foreground/80 hover:text-foreground hover:underline"
            >
              {finderLabel}
            </button>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
