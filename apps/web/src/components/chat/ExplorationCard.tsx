import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  SearchIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { memo, useState } from "react";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";

interface ExplorationCardProps {
  entries: ReadonlyArray<WorkLogEntry>;
  isLive: boolean;
  isPendingApproval?: boolean;
}

const READ_TOOL_NAMES = new Set(["read", "cat", "head", "tail", "view"]);
const SEARCH_TOOL_NAMES = new Set(["grep", "glob", "search", "toolsearch", "find", "list", "ls"]);
const SEARCH_QUERY_KEYS = ["pattern", "query", "q", "searchQuery", "term"] as const;

function isReadEntry(entry: WorkLogEntry): boolean {
  if (entry.requestKind === "file-read") return true;
  if (entry.itemType === "file_read" && !isSearchToolName(entry.toolName)) return true;
  if (entry.toolName && READ_TOOL_NAMES.has(entry.toolName.toLowerCase())) return true;
  const heading = (entry.toolTitle ?? entry.label).trim().toLowerCase();
  return heading.startsWith("read");
}

function isSearchToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return SEARCH_TOOL_NAMES.has(toolName.toLowerCase());
}

function fileNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function inputStr(input: Record<string, unknown> | undefined, key: string): string | null {
  if (!input) return null;
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function inputNum(input: Record<string, unknown> | undefined, key: string): number | null {
  if (!input) return null;
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inputFilePath(input: Record<string, unknown> | undefined): string | null {
  return inputStr(input, "file_path") ?? inputStr(input, "filePath") ?? inputStr(input, "path");
}

function extractSearchQuery(input: Record<string, unknown> | undefined): string | null {
  for (const key of SEARCH_QUERY_KEYS) {
    const value = inputStr(input, key);
    if (value) return value;
  }
  return null;
}

function formatLineRange(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const offset = inputNum(input, "offset");
  const limit = inputNum(input, "limit");
  if (offset !== null && limit !== null) {
    return `L${offset + 1}–${offset + limit}`;
  }
  if (offset !== null) {
    return `from L${offset + 1}`;
  }
  if (limit !== null && limit < 2000) {
    return `first ${limit} lines`;
  }
  return null;
}

function explorationEntryHeading(entry: WorkLogEntry): string {
  const input = entry.toolInput;
  const lower = entry.toolName?.toLowerCase();

  if (lower === "read") {
    const filePath = inputFilePath(input);
    const fileName = filePath
      ? fileNameFromPath(filePath)
      : extractFileNameFromDetail(entry.detail);
    const lineRange = formatLineRange(input);
    if (fileName && lineRange) return `Read ${fileName} (${lineRange})`;
    if (fileName) return `Read ${fileName}`;
    return "Read file";
  }

  if (lower === "grep") {
    const pattern = inputStr(input, "pattern");
    const path = inputFilePath(input);
    if (pattern && path) return `Searched for ${pattern} in ${fileNameFromPath(path)}`;
    if (pattern) return `Searched for ${pattern}`;
    return `Searched ${extractSearchSummaryFromDetail(entry.detail)}`;
  }

  if (lower === "glob") {
    const pattern = inputStr(input, "pattern");
    const path = inputFilePath(input);
    if (pattern && path) return `Glob ${pattern} in ${fileNameFromPath(path)}`;
    if (pattern) return `Glob ${pattern}`;
    return `Glob ${extractSearchSummaryFromDetail(entry.detail)}`;
  }

  if (lower === "list" || lower === "ls") {
    const path = inputFilePath(input);
    if (path) return `Listed ${fileNameFromPath(path)}`;
    return `Listed ${extractPathSummaryFromDetail(entry.detail)}`;
  }

  if (lower === "find") {
    const path = inputFilePath(input);
    if (path) return `Found ${fileNameFromPath(path)}`;
    return `Found ${extractPathSummaryFromDetail(entry.detail)}`;
  }

  if (lower === "toolsearch") {
    const query = extractSearchQuery(input);
    if (query) return `Searched tools for ${query}`;
    const summary = extractSearchSummaryFromDetail(entry.detail);
    return summary ? `Searched tools ${summary}` : "Searched tools";
  }

  if (lower && lower.includes("search")) {
    const query = extractSearchQuery(input);
    const path = inputFilePath(input);
    if (query && path) return `Searched for ${query} in ${fileNameFromPath(path)}`;
    if (query) return `Searched for ${query}`;
    const summary = extractSearchSummaryFromDetail(entry.detail);
    return summary ? `Searched ${summary}` : "Searched";
  }

  const raw = (entry.toolTitle ?? entry.label).trim();
  if (isGenericLabel(raw) && entry.detail) {
    return cleanDetailAsHeading(entry.detail);
  }
  const titled = raw.length === 0 ? "Explored" : `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;

  const fallbackPath = inputFilePath(input);
  const fallbackQuery = extractSearchQuery(input);
  if (fallbackQuery && fallbackPath) {
    return `${titled}: ${fallbackQuery} in ${fileNameFromPath(fallbackPath)}`;
  }
  if (fallbackQuery) return `${titled}: ${fallbackQuery}`;
  if (fallbackPath) return `${titled} ${fileNameFromPath(fallbackPath)}`;

  if (entry.detail) {
    const summary = extractSearchSummaryFromDetail(entry.detail);
    if (summary && summary !== titled) return `${titled}: ${summary}`;
  }
  return titled;
}

function isGenericLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower === "tool call" ||
    lower === "tool" ||
    lower === "tool call completed" ||
    lower === "tool call started" ||
    lower === "tool updated" ||
    lower === "item"
  );
}

function stripToolPrefix(value: string): string {
  return value.replace(/^[A-Za-z_]+:\s*/, "").trim();
}

function tryParseJson(value: string): Record<string, unknown> | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractFilePathFromValue(value: string): string | null {
  const parsed = tryParseJson(value);
  if (parsed) {
    const path =
      typeof parsed.file_path === "string"
        ? parsed.file_path
        : typeof parsed.filePath === "string"
          ? parsed.filePath
          : typeof parsed.path === "string"
            ? parsed.path
            : null;
    return path;
  }
  if (value.includes("/")) return value.trim();
  return null;
}

function extractFileNameFromDetail(detail: string | undefined): string {
  if (!detail) return "";
  const cleaned = stripToolPrefix(detail);
  const filePath = extractFilePathFromValue(cleaned);
  if (filePath) return fileNameFromPath(filePath);
  return "";
}

function extractSearchSummaryFromDetail(detail: string | undefined): string {
  if (!detail) return "";
  const cleaned = stripToolPrefix(detail);
  const parsed = tryParseJson(cleaned);
  if (parsed) {
    const query = SEARCH_QUERY_KEYS.map((key) => parsed[key]).find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    const path = typeof parsed.path === "string" ? parsed.path : null;
    if (query && path) return `${query} in ${fileNameFromPath(path)}`;
    if (query) return query;
  }
  return cleaned.slice(0, 120);
}

function extractPathSummaryFromDetail(detail: string | undefined): string {
  if (!detail) return "";
  const cleaned = stripToolPrefix(detail);
  const filePath = extractFilePathFromValue(cleaned);
  if (filePath) {
    const parts = filePath.split("/");
    return parts.slice(-2).join("/");
  }
  return cleaned.slice(0, 120);
}

function cleanDetailAsHeading(detail: string): string {
  const cleaned = stripToolPrefix(detail);
  const filePath = extractFilePathFromValue(cleaned);
  if (filePath) return `Read ${fileNameFromPath(filePath)}`;
  return cleaned.slice(0, 80);
}

function ExplorationEntryRow(props: { entry: WorkLogEntry }) {
  const { entry } = props;
  const isRead = isReadEntry(entry);
  const Icon = isRead ? EyeIcon : SearchIcon;
  const heading = explorationEntryHeading(entry);

  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-0.5">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/50">
        <Icon className="size-3" />
      </span>
      <p className="min-w-0 flex-1 truncate text-[11px] leading-5 text-muted-foreground/70">
        <span className="text-foreground/70">{heading}</span>
      </p>
    </div>
  );
}

export const ExplorationCard = memo(function ExplorationCard(props: ExplorationCardProps) {
  const { entries, isLive, isPendingApproval = false } = props;
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const readCount = entries.filter(isReadEntry).length;
  const searchCount = entries.length - readCount;

  const headerParts: string[] = [];
  if (readCount > 0) headerParts.push(`${readCount} file${readCount !== 1 ? "s" : ""}`);
  if (searchCount > 0) headerParts.push(`${searchCount} search${searchCount !== 1 ? "es" : ""}`);
  const summary = headerParts.join(", ");

  const verb = isLive ? "Exploring" : "Explored";
  const ToggleIcon = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      data-scroll-anchor-target
      className={cn(
        "overflow-hidden rounded-xl border border-border/40 border-l-2 bg-card/25",
        isLive ? "border-l-blue-400/40" : "border-l-blue-400/20",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 hover:bg-muted/20"
      >
        <ToggleIcon className="size-3 shrink-0 text-muted-foreground/50" />
        <SearchIcon className="size-3.5 shrink-0 text-blue-400/50" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
          {verb} {summary}
        </span>
        {isPendingApproval ? (
          <span className="flex items-center gap-1 text-[10px] text-blue-400/70">
            <ShieldQuestionIcon className="size-3" />
            Approval requested
          </span>
        ) : (
          isLive && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-400/60" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/20 px-2 py-1">
          {entries.map((entry) => (
            <ExplorationEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
});
