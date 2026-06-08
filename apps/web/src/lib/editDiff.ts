import { createPatch } from "diff";

/**
 * Extracts a unified-diff patch string from a file-change tool's activity
 * payload, normalizing across providers so the timeline can render the real
 * code change with the same diff component used in the diff tab.
 *
 * Provider shapes handled (all read from `payload.data`):
 * - OpenCode `edit`/`write`: `state.metadata.diff` is already a unified diff.
 * - Codex: `item.changes[]` carries `{ diff, kind, path, move_path }` where
 *   `update` is a header-less unified hunk and `add`/`delete` are raw content.
 * - Claude: `input.{ file_path, old_string, new_string }` — synthesized into a
 *   unified diff via the `diff` library.
 *
 * Returns `undefined` when no diff can be derived.
 */
export function extractEditDiff(payload: Record<string, unknown> | null): string | undefined {
  const data = asRecord(payload?.data);
  if (!data) {
    return undefined;
  }

  return openCodeEditDiff(data) ?? codexEditDiff(data) ?? claudeEditDiff(data) ?? undefined;
}

function openCodeEditDiff(data: Record<string, unknown>): string | undefined {
  const metadata = asRecord(asRecord(data.state)?.metadata);
  const diff = asNonEmptyString(metadata?.diff);
  return diff ?? undefined;
}

interface CodexChange {
  readonly diff: string;
  readonly path: string;
  readonly kind: "add" | "delete" | "update";
  readonly movePath?: string;
}

function codexEditDiff(data: Record<string, unknown>): string | undefined {
  const changes = asRecord(data.item)?.changes;
  if (!Array.isArray(changes)) {
    return undefined;
  }
  const patches: string[] = [];
  for (const raw of changes) {
    const change = normalizeCodexChange(raw);
    if (change) {
      patches.push(codexChangeToUnifiedDiff(change));
    }
  }
  return patches.length > 0 ? patches.join("\n") : undefined;
}

function normalizeCodexChange(raw: unknown): CodexChange | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const path = asNonEmptyString(record.path);
  const diff = typeof record.diff === "string" ? record.diff : undefined;
  const kindRecord = asRecord(record.kind);
  const kindType = asNonEmptyString(kindRecord?.type);
  if (!path || diff === undefined) {
    return null;
  }
  if (kindType !== "add" && kindType !== "delete" && kindType !== "update") {
    return null;
  }
  const movePath = asNonEmptyString(kindRecord?.move_path);
  return {
    diff,
    path,
    kind: kindType,
    ...(movePath ? { movePath } : {}),
  };
}

function codexChangeToUnifiedDiff(change: CodexChange): string {
  const oldPath = `a/${stripLeadingSlash(change.path)}`;
  const newPath = `b/${stripLeadingSlash(change.movePath ?? change.path)}`;

  if (change.kind === "update") {
    // Codex provides a header-less unified hunk; prepend the file headers.
    const body = change.diff.endsWith("\n") ? change.diff : `${change.diff}\n`;
    return `--- ${oldPath}\n+++ ${newPath}\n${body}`;
  }

  const lines = splitKeepingContent(change.diff);
  if (change.kind === "add") {
    const hunkLines = lines.map((line) => `+${line}`);
    return `--- /dev/null\n+++ ${newPath}\n@@ -0,0 +1,${lines.length} @@\n${hunkLines.join("\n")}\n`;
  }
  // delete
  const hunkLines = lines.map((line) => `-${line}`);
  return `--- ${oldPath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${hunkLines.join("\n")}\n`;
}

function claudeEditDiff(data: Record<string, unknown>): string | undefined {
  const input = asRecord(data.input);
  if (!input) {
    return undefined;
  }
  const filePath = asNonEmptyString(input.file_path) ?? asNonEmptyString(input.filePath);
  const oldString = typeof input.old_string === "string" ? input.old_string : undefined;
  const newString = typeof input.new_string === "string" ? input.new_string : undefined;
  if (!filePath || oldString === undefined || newString === undefined) {
    return undefined;
  }
  if (oldString === newString) {
    return undefined;
  }
  const relativePath = stripLeadingSlash(filePath);
  const patch = createPatch(relativePath, oldString, newString, undefined, undefined, {
    context: 3,
  });
  return patch.trim().length > 0 ? patch : undefined;
}

function splitKeepingContent(content: string): string[] {
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return normalized.length === 0 ? [] : normalized.split("\n");
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/u, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
