import type { TerminalSummary } from "@t3tools/contracts";

/** Human-readable label for a terminal tab; matches mobile and web sidebars. */
function decodeTerminalLabelPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatActionTerminalLabel(actionId: string): string {
  const fallbackMatch = /^(.*):([1-9][0-9]*)$/.exec(actionId);
  if (fallbackMatch) {
    const scriptId = decodeTerminalLabelPart(fallbackMatch[1] ?? "").replace(/[-:]+/g, " ");
    return `${scriptId} (${fallbackMatch[2]})`;
  }
  return decodeTerminalLabelPart(actionId).replace(/[-:]+/g, " ");
}

export function getTerminalLabel(terminalId: string): string {
  const numericSuffix = /^term(?:inal)?-(\d+)$/i.exec(terminalId)?.[1];
  if (numericSuffix) {
    return `Terminal ${numericSuffix}`;
  }

  const actionId = /^action-(.+)$/i.exec(terminalId)?.[1]?.trim();
  if (actionId) {
    return `Action: ${formatActionTerminalLabel(actionId)}`;
  }

  return terminalId;
}

/** Prefer server summary label when present; otherwise fall back to `getTerminalLabel`. */
export function resolveTerminalSessionLabel(
  terminalId: string,
  summary: Pick<TerminalSummary, "label"> | null | undefined,
): string {
  const trimmed = summary?.label?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  return getTerminalLabel(terminalId);
}

/**
 * Client-side terminal id allocator. Ids are ALWAYS chosen by the client and sent explicitly
 * on every `terminal.open` / `terminal.attach` call — the server never allocates.
 *
 * Returns the lowest unused `term-N` id (starting at `term-1`), skipping any ids already in
 * `existingTerminalIds`.
 */
export function nextTerminalId(existingTerminalIds: ReadonlyArray<string>): string {
  const usedIds = new Set(existingTerminalIds.filter((id) => id.trim().length > 0));
  let nextIndex = 1;
  while (usedIds.has(`term-${nextIndex}`)) {
    nextIndex += 1;
  }

  return `term-${nextIndex}`;
}
