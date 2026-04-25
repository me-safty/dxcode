import { type MessageId } from "@t3tools/contracts";

import { deriveDisplayedUserMessageState } from "../../lib/terminalContext.ts";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";

export interface MinimapUserMessageEntry {
  rowIndex: number;
  rowKey: string;
  messageId: MessageId;
  previewText: string;
}

export interface MinimapListStateSnapshot {
  scroll: number;
  scrollLength: number;
  positionByKey?: (key: string) => number | undefined;
  positionAtIndex?: (index: number) => number | undefined;
}

export function selectUserMessageMinimapEntries(
  rows: ReadonlyArray<MessagesTimelineRow>,
): MinimapUserMessageEntry[] {
  const entries: MinimapUserMessageEntry[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.kind !== "message" || row.message.role !== "user") {
      continue;
    }
    const displayed = deriveDisplayedUserMessageState(row.message.text ?? "");
    const visible = displayed.visibleText.trim();
    const previewText =
      visible.length > 0 ? visible : displayed.contextCount > 0 ? "(terminal context)" : "";
    entries.push({
      rowIndex,
      rowKey: row.id,
      messageId: row.message.id,
      previewText,
    });
  }
  return entries;
}

export function computeActiveMinimapIndex(
  state: MinimapListStateSnapshot,
  entries: ReadonlyArray<MinimapUserMessageEntry>,
): number | undefined {
  if (entries.length === 0) return undefined;
  if (state.scrollLength <= 0) return undefined;

  const threshold = state.scroll + 8;
  let next = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const position = state.positionByKey?.(entry.rowKey) ?? state.positionAtIndex?.(entry.rowIndex);
    if (position === undefined) continue;
    if (position <= threshold) {
      next = i;
    } else {
      break;
    }
  }

  while (next + 1 < entries.length) {
    const currentEntry = entries[next]!;
    const nextEntry = entries[next + 1]!;
    const currentMessageBottom = state.positionAtIndex?.(currentEntry.rowIndex + 1);
    const nextEntryTop =
      state.positionByKey?.(nextEntry.rowKey) ?? state.positionAtIndex?.(nextEntry.rowIndex);
    if (currentMessageBottom === undefined || nextEntryTop === undefined) break;
    if (currentMessageBottom > state.scroll) break;
    if (nextEntryTop > state.scroll + state.scrollLength) break;
    next += 1;
  }
  return next;
}
