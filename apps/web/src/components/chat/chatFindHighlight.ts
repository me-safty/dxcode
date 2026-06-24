/**
 * Resolve a character `offset` (into the concatenated text of consecutive text
 * nodes whose lengths are `lengths`) to a `(nodeIndex, localOffset)` pair. A
 * boundary offset binds to the earlier node's end so a Range start/end can sit
 * exactly at a node edge. Returns null when offset exceeds the total length.
 */
export function mapOffsetToNode(
  lengths: ReadonlyArray<number>,
  offset: number,
): { nodeIndex: number; localOffset: number } | null {
  if (offset < 0) return null;
  let acc = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const len = lengths[index] ?? 0;
    if (offset <= acc + len) {
      return { nodeIndex: index, localOffset: offset - acc };
    }
    acc += len;
  }
  return null;
}

// ─── Live Highlight Glue ───────────────────────────────────────────────────

import type { Match, SearchOptions } from "./chatSearch";

const MATCH_REGISTRY = "t3-find-match";
const CURRENT_REGISTRY = "t3-find-current";

function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

export function clearFindHighlights(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(MATCH_REGISTRY);
  CSS.highlights.delete(CURRENT_REGISTRY);
}

/** Collect content text nodes under a root, skipping chrome (`data-find-skip`). */
function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (parent?.closest("[data-find-skip]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

function rangeFor(nodes: Text[], lengths: number[], start: number, end: number): Range | null {
  const startPos = mapOffsetToNode(lengths, start);
  const endPos = mapOffsetToNode(lengths, end);
  if (!startPos || !endPos) return null;
  const range = document.createRange();
  range.setStart(nodes[startPos.nodeIndex]!, startPos.localOffset);
  range.setEnd(nodes[endPos.nodeIndex]!, endPos.localOffset);
  return range;
}

/** Work rows expose grouped entry ids via data attributes on their entry roots. */
function rowIdHoldsEntry(row: HTMLElement, entryId: string): boolean {
  return row.querySelector(`[data-find-entry-id="${CSS.escape(entryId)}"]`) !== null;
}

/**
 * Rebuild the find highlight registries from currently-materialised rows.
 *
 * For each rendered content container, scan its concatenated textContent for
 * the query and build Ranges; the active match (by entryId + occurrence) goes
 * to the `current` registry. Falls back to flashing the row container when an
 * exact range can't be built.
 *
 * `matches` is accepted so callers don't need to guard before calling; the
 * implementation re-scans the live DOM text and doesn't read the array because
 * DOM text may diverge from the projected-markdown source used by buildMatches.
 */
export function applyFindHighlights(
  container: HTMLElement,
  query: string,
  opts: SearchOptions,
  _matches: ReadonlyArray<Match>,
  activeMatch: Match | null,
): void {
  if (!highlightsSupported() || query.length === 0) {
    clearFindHighlights();
    return;
  }

  const matchRanges: Range[] = [];
  const currentRanges: Range[] = [];
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  // At most one range should be classified as the active/current match. When a
  // work row exposes multiple [data-find-content] containers (label, detail,
  // command, toolTitle), per-container occurrence counters diverge from
  // buildMatches' per-field occurrences, causing multiple ranges to appear
  // active. Track whether we've already assigned a current range so any
  // subsequent "active" hits are demoted to regular matches.
  let currentAssigned = false;

  for (const row of container.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
    for (const content of row.querySelectorAll<HTMLElement>(
      "[data-find-content], [data-user-message-body]",
    )) {
      const nodes = collectTextNodes(content);
      if (nodes.length === 0) continue;
      const lengths = nodes.map((node) => node.length);
      const text = nodes.map((node) => node.data).join("");
      const hay = opts.caseSensitive ? text : text.toLowerCase();
      const rowId = row.getAttribute("data-timeline-row-id");
      let occurrence = 0;
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        const range = rangeFor(nodes, lengths, at, at + query.length);
        if (range) {
          const isActive =
            activeMatch !== null &&
            (rowId === activeMatch.entryId || rowIdHoldsEntry(row, activeMatch.entryId)) &&
            occurrence === activeMatch.occurrence;
          if (isActive && !currentAssigned) {
            currentRanges.push(range);
            currentAssigned = true;
          } else {
            matchRanges.push(range);
          }
        }
        occurrence += 1;
      }
    }
  }

  if (matchRanges.length === 0 && currentRanges.length === 0) {
    clearFindHighlights();
    return;
  }

  CSS.highlights.set(MATCH_REGISTRY, new Highlight(...matchRanges));
  CSS.highlights.set(CURRENT_REGISTRY, new Highlight(...currentRanges));

  // Fallback: flash the active row when no current range was built (e.g. custom
  // chips or raw-HTML content whose text diverges from the projected markdown).
  if (activeMatch && currentRanges.length === 0) {
    const rowEl =
      container.querySelector<HTMLElement>(
        `[data-timeline-row-id="${CSS.escape(activeMatch.entryId)}"]`,
      ) ??
      container
        .querySelector<HTMLElement>(`[data-find-entry-id="${CSS.escape(activeMatch.entryId)}"]`)
        ?.closest<HTMLElement>("[data-timeline-row-id]") ??
      null;
    if (rowEl) {
      // Clear any pending flash timer so overlapping rAF-driven re-applications
      // don't stack timeouts and restart the animation mid-way.
      const prev = Number(rowEl.dataset.findFlashTimer);
      if (prev) window.clearTimeout(prev);
      rowEl.classList.add("t3-find-flash");
      rowEl.dataset.findFlashTimer = String(
        window.setTimeout(() => {
          rowEl.classList.remove("t3-find-flash");
          delete rowEl.dataset.findFlashTimer;
        }, 600),
      );
    }
  }
}
