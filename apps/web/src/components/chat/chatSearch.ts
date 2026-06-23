import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

import type { TurnId } from "@t3tools/contracts";
import {
  type TimelineEntry,
  type WorkLogEntry,
  workEntryIndicatesToolNeutralStatus,
} from "../../session-logic";

export type MatchField = "text" | "plan" | "label" | "detail" | "command" | "toolTitle";

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

/** Projects markdown to the plain text react-markdown will render (best-effort). */
function projectMarkdown(markdown: string): string {
  if (markdown.trim().length === 0) return "";
  return mdastToString(markdownProcessor.parse(markdown));
}

function workFields(entry: WorkLogEntry): Array<{ field: MatchField; text: string }> {
  const units: Array<{ field: MatchField; text: string }> = [];
  const push = (field: MatchField, value: string | undefined) => {
    if (value && value.trim().length > 0) units.push({ field, text: value });
  };
  push("label", entry.label);
  push("detail", entry.detail);
  push("command", entry.command);
  push("toolTitle", entry.toolTitle);
  return units;
}

export function projectEntryText(entry: TimelineEntry): Array<{ field: MatchField; text: string }> {
  switch (entry.kind) {
    case "message": {
      const text = projectMarkdown(entry.message.text);
      return text.length > 0 ? [{ field: "text", text }] : [];
    }
    case "proposed-plan": {
      const text = projectMarkdown(entry.proposedPlan.planMarkdown);
      return text.length > 0 ? [{ field: "plan", text }] : [];
    }
    case "work": {
      // Honesty filter: never index work entries the renderer drops.
      if (workEntryIndicatesToolNeutralStatus(entry.entry)) return [];
      return workFields(entry.entry);
    }
  }
}

export interface Match {
  matchId: string;
  entryId: string;
  entryKind: TimelineEntry["kind"];
  turnId: TurnId | null;
  field: MatchField;
  occurrence: number;
  start: number;
  end: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
}

function turnIdForEntry(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message") return entry.message.turnId ?? null;
  if (entry.kind === "work") return entry.entry.turnId ?? null;
  if (entry.kind === "proposed-plan") return entry.proposedPlan.turnId ?? null;
  return null;
}

/**
 * Non-overlapping left-to-right scan; returns [start, end) offsets into the ORIGINAL `text`.
 *
 * For case-insensitive matching we build an uppercased shadow of `text` and a `shadowToOrig`
 * array so that every shadow position resolves to its original-string index in O(1).
 * Each original char `i` contributes one entry per code unit its toUpperCase() produces,
 * so even length-changing folds (e.g. ß → SS) are handled without while-loop restarts.
 */
function scanOccurrences(
  text: string,
  needle: string,
  caseSensitive: boolean,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  if (caseSensitive) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      spans.push([at, at + needle.length]);
      from = at + needle.length;
    }
    return spans;
  }

  // Build uppercased shadow + shadowToOrig[j] = original-string index for shadow position j.
  // For each original char i, push i once per code unit its toUpperCase() produces so every
  // shadow offset resolves to its source in O(1) — no while-loop restarts per match.
  const shadowToOrig: number[] = [];
  let shadow = "";
  for (let i = 0; i < text.length; i++) {
    const upper = (text[i] ?? "").toUpperCase();
    for (let j = 0; j < upper.length; j++) {
      shadowToOrig.push(i);
    }
    shadow += upper;
  }

  const shadowNeedle = needle.toUpperCase();
  let from = 0;
  for (;;) {
    const at = shadow.indexOf(shadowNeedle, from);
    if (at === -1) break;

    const shadowEnd = at + shadowNeedle.length;
    const startO = shadowToOrig[at] ?? 0;
    const endO = shadowToOrig[shadowEnd] ?? text.length;

    spans.push([startO, endO]);
    from = shadowEnd;
  }
  return spans;
}

export function buildMatches(
  entries: ReadonlyArray<TimelineEntry>,
  query: string,
  opts: SearchOptions,
): Match[] {
  if (query.length === 0) return [];
  const matches: Match[] = [];
  for (const entry of entries) {
    const turnId = turnIdForEntry(entry);
    for (const unit of projectEntryText(entry)) {
      let occurrence = 0;
      for (const [start, end] of scanOccurrences(unit.text, query, opts.caseSensitive)) {
        matches.push({
          matchId: `${entry.id}:${unit.field}:${occurrence}`,
          entryId: entry.id,
          entryKind: entry.kind,
          turnId,
          field: unit.field,
          occurrence,
          start,
          end,
        });
        occurrence += 1;
      }
    }
  }
  return matches;
}

export function reconcileActiveMatch(
  matches: ReadonlyArray<Match>,
  activeMatchId: string | null,
  prevIndex: number,
): number {
  if (matches.length === 0) return 0;
  if (activeMatchId !== null) {
    const found = matches.findIndex((m) => m.matchId === activeMatchId);
    if (found !== -1) return found;
  }
  return Math.min(Math.max(prevIndex, 0), matches.length - 1);
}
