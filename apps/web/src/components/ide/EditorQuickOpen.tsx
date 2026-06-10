import { useEffect, useMemo, useRef, useState } from "react";
import { RegexIcon } from "lucide-react";

import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { readEnvironmentApi } from "../../environmentApi";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";

interface EditorQuickOpenProps {
  environmentId: EnvironmentId;
  cwd: string;
  onPick: (path: string, name: string) => void;
  onClose: () => void;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * VS Code-style Cmd+P file quick-open. Fuzzy-searches the project's files via
 * the `projects.searchEntries` index; a regex toggle filters the results with a
 * RegExp instead.
 */
export function EditorQuickOpen(props: EditorQuickOpenProps) {
  const { environmentId, cwd, onPick, onClose } = props;
  const { resolvedTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [entries, setEntries] = useState<ProjectEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch from the workspace entry index.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        return;
      }
      // In regex mode send a literal seed (alphanumeric run) to gather a wide
      // candidate set, then filter client-side; in fuzzy mode send the query.
      const seed = regex ? (trimmed.match(/[A-Za-z0-9_]+/)?.[0] ?? trimmed) : trimmed;
      api.projects
        .searchEntries({ cwd, query: seed, limit: 200 })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setEntries(result.entries.filter((entry) => entry.kind === "file"));
          setActiveIndex(0);
        })
        .catch(() => {
          if (!cancelled) {
            setEntries([]);
          }
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, regex, cwd, environmentId]);

  const results = useMemo(() => {
    if (!regex) {
      return entries.slice(0, 50);
    }
    let re: RegExp | null = null;
    try {
      re = new RegExp(query.trim(), "i");
    } catch {
      re = null;
    }
    if (!re) {
      return entries.slice(0, 50);
    }
    return entries.filter((entry) => re!.test(entry.path)).slice(0, 50);
  }, [entries, regex, query]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[activeIndex];
      if (entry) {
        onPick(entry.path, basename(entry.path));
        onClose();
      }
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex justify-center pt-[10vh]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative z-10 flex h-fit max-h-[70%] w-[min(36rem,90%)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={regex ? "Search files by regex…" : "Search files by name…"}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            aria-label="Toggle regex"
            onClick={() => setRegex((value) => !value)}
            className={cn(
              "flex size-6 items-center justify-center rounded-md",
              regex
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
            )}
          >
            <RegexIcon className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">
              {query.trim() ? "No matching files" : "Type to search files"}
            </div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onPick(entry.path, basename(entry.path));
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1 text-left text-sm",
                  index === activeIndex ? "bg-accent text-foreground" : "text-foreground/90",
                )}
              >
                <VscodeEntryIcon
                  pathValue={entry.path}
                  kind="file"
                  theme={resolvedTheme}
                  className="size-4 shrink-0"
                />
                <span className="truncate">{basename(entry.path)}</span>
                <span className="ml-auto truncate pl-3 text-xs text-muted-foreground/60">
                  {entry.path}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
