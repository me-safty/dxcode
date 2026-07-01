/**
 * Compute the text to splice into the composer at `cursor` for a dictated
 * chunk. Append-only: never rewrites existing text. Adds a single leading
 * space when the preceding character is a non-space, non-newline so words do
 * not run together; returns "" for an empty/whitespace chunk.
 */
export function dictationInsertText(prompt: string, cursor: number, chunk: string): string {
  const trimmed = chunk.trim();
  if (trimmed.length === 0) return "";
  const before = cursor > 0 ? prompt[cursor - 1] : undefined;
  const needsLeadingSpace = before !== undefined && before !== " " && before !== "\n";
  return needsLeadingSpace ? ` ${trimmed}` : trimmed;
}
