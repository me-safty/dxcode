import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  HomeIcon,
  MonitorIcon,
  SearchIcon,
} from "lucide-react";

import type { EnvironmentId, ProjectEntry } from "@marcode/contracts";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Kbd, KbdGroup } from "../ui/kbd";
import { projectBrowseDirectoriesQueryOptions } from "~/lib/projectReactQuery";
import { readLocalApi } from "~/localApi";
import { useTheme } from "~/hooks/useTheme";
import { basenameOfPath } from "~/vscode-icons";
import { cn, isMacPlatform } from "~/lib/utils";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

const FILTER_DEBOUNCE_MS = 120;

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

function buildBreadcrumbSegments(absolutePath: string): Array<{ label: string; path: string }> {
  const normalized = normalizeTrailingSlash(absolutePath);
  if (!normalized || normalized === "/") {
    return [{ label: "/", path: "/" }];
  }
  const parts = normalized.split("/").filter(Boolean);
  const segments: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let accumulator = "";
  for (const part of parts) {
    accumulator = `${accumulator}/${part}`;
    segments.push({ label: part, path: accumulator });
  }
  return segments;
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
  const { resolvedTheme } = useTheme();
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

  useEffect(() => {
    setHighlightedIndex(filteredEntries.length > 0 ? 0 : -1);
  }, [filteredEntries]);

  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const breadcrumbSegments = useMemo(
    () => buildBreadcrumbSegments(resolvedParent || currentPath),
    [resolvedParent, currentPath],
  );

  const navigateInto = useCallback(
    (entry: ProjectEntry) => {
      const base = resolvedParent || currentPath;
      const name = basenameOfPath(entry.path);
      setCurrentPath(joinPath(base, name));
      setFilterInput("");
      filterInputRef.current?.focus();
    },
    [resolvedParent, currentPath],
  );

  const canGoUp = useMemo(() => {
    const base = resolvedParent || currentPath;
    return parentOfPath(base) !== null;
  }, [resolvedParent, currentPath]);

  const goUp = useCallback(() => {
    const base = resolvedParent || currentPath;
    const parent = parentOfPath(base);
    if (parent !== null) {
      setCurrentPath(parent);
      setFilterInput("");
    }
  }, [resolvedParent, currentPath]);

  const goHome = useCallback(() => {
    setCurrentPath("~/");
    setFilterInput("");
  }, []);

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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        if (filteredEntries.length === 0) return;
        event.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % filteredEntries.length);
      } else if (event.key === "ArrowUp") {
        if (filteredEntries.length === 0) return;
        event.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? filteredEntries.length - 1 : prev - 1));
      } else if (event.key === "Enter") {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          void handleConfirm(resolvedParent || currentPath);
          return;
        }
        if (highlightedIndex >= 0 && filteredEntries[highlightedIndex]) {
          event.preventDefault();
          navigateInto(filteredEntries[highlightedIndex]);
        }
      } else if (event.key === "Backspace" && filterInput === "" && canGoUp) {
        event.preventDefault();
        goUp();
      }
    },
    [
      filteredEntries,
      highlightedIndex,
      navigateInto,
      handleConfirm,
      resolvedParent,
      currentPath,
      filterInput,
      canGoUp,
      goUp,
    ],
  );

  const canConfirm = (resolvedParent || currentPath).length > 0 && !isConfirming;
  const isDesktop = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const isMac = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;
  const modKeyLabel = isMac ? "⌘" : "Ctrl";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <div className="mt-1 flex items-center gap-1 overflow-x-auto text-muted-foreground text-xs">
            {breadcrumbSegments.map((segment, index) => (
              <div key={segment.path} className="flex shrink-0 items-center gap-1">
                {index > 0 && <ChevronRightIcon className="size-3 text-muted-foreground/60" />}
                <button
                  type="button"
                  onClick={() => setCurrentPath(segment.path)}
                  className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                >
                  {segment.label}
                </button>
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-3" onKeyDown={handleKeyDown}>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goUp}
              disabled={!canGoUp}
              aria-label="Go up one directory"
              title="Go up one directory"
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goHome}
              aria-label="Go to home directory"
              title="Go to home directory"
            >
              <HomeIcon />
            </Button>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <input
                ref={filterInputRef}
                type="text"
                className="w-full rounded-md border border-border bg-secondary py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-1 focus:ring-ring"
                placeholder="Filter folders in this directory…"
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div
            ref={listRef}
            className="flex max-h-72 min-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-background p-1"
          >
            {browseQuery.isFetching && (entries?.length ?? 0) === 0 ? (
              <span className="px-3 py-6 text-center text-muted-foreground text-xs">Loading…</span>
            ) : filteredEntries.length === 0 ? (
              <span className="px-3 py-6 text-center text-muted-foreground text-xs">
                {browseQuery.isError
                  ? "Unable to read this directory."
                  : (entries?.length ?? 0) === 0
                    ? "This directory is empty or inaccessible."
                    : "No folders match the filter."}
              </span>
            ) : (
              filteredEntries.map((entry, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      isHighlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => navigateInto(entry)}
                    onDoubleClick={() => navigateInto(entry)}
                  >
                    <VscodeEntryIcon
                      pathValue={entry.path}
                      kind={entry.kind}
                      theme={resolvedTheme}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {basenameOfPath(entry.path) || entry.path}
                    </span>
                    {isHighlighted ? (
                      <KbdGroup className="ml-auto shrink-0 text-muted-foreground">
                        <Kbd>↵</Kbd>
                        <span className="text-[10px]">Open</span>
                      </KbdGroup>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          {allowNativePicker && isDesktop ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleNativePicker()}
              className="mr-auto"
            >
              <MonitorIcon />
              Browse with system…
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canConfirm}
            onClick={() => void handleConfirm(resolvedParent || currentPath)}
          >
            <FolderOpenIcon />
            {isConfirming ? "Adding…" : confirmLabel}
            {!isConfirming ? (
              <KbdGroup className="ml-1 opacity-80">
                <Kbd className="bg-primary-foreground/15 text-primary-foreground">
                  {modKeyLabel}
                </Kbd>
                <Kbd className="bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
              </KbdGroup>
            ) : null}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
