import type { ReviewStackAnchor } from "@t3tools/contracts";

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function decodeGitQuotedPath(value: string): string | null {
  if (!(value.startsWith('"') && value.endsWith('"'))) return null;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Readonly<Record<string, number>> = {
    a: 0x07,
    b: 0x08,
    t: 0x09,
    n: 0x0a,
    v: 0x0b,
    f: 0x0c,
    r: 0x0d,
    '"': 0x22,
    "\\": 0x5c,
  };
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index] ?? "";
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) return null;
    if (/[0-7]/.test(escaped)) {
      const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
      if (!octal) return null;
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    bytes.push(escapes[escaped] ?? escaped.codePointAt(0) ?? 0);
    index += 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function parseQuotedPathToken(value: string): readonly [string, string] | null {
  if (!value.startsWith('"')) return null;
  let escaped = false;
  let closingQuote = -1;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && !escaped) {
      closingQuote = index;
      break;
    }
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  if (closingQuote < 0) return null;
  const path = decodeGitQuotedPath(value.slice(0, closingQuote + 1));
  return path === null ? null : [path, value.slice(closingQuote + 1)];
}

function parseDiffHeader(line: string): readonly [string, string] | null {
  const unquoted = DIFF_HEADER.exec(line);
  if (unquoted) return [unquoted[1] ?? "", unquoted[2] ?? ""];
  if (!line.startsWith("diff --git ")) return null;
  const body = line.slice("diff --git ".length);
  let oldToken: string;
  let newToken: string;
  if (body.startsWith('"')) {
    const parsedOld = parseQuotedPathToken(body);
    if (!parsedOld || !parsedOld[1].startsWith(" ")) return null;
    oldToken = parsedOld[0];
    const newValue = parsedOld[1].slice(1);
    const parsedNew = parseQuotedPathToken(newValue);
    newToken = parsedNew ? (parsedNew[1] === "" ? parsedNew[0] : "") : newValue;
  } else {
    const quotedNewStart = body.lastIndexOf(' "b/');
    if (quotedNewStart < 0) return null;
    oldToken = body.slice(0, quotedNewStart);
    const parsedNew = parseQuotedPathToken(body.slice(quotedNewStart + 1));
    newToken = parsedNew?.[1] === "" ? parsedNew[0] : "";
  }
  const oldPath = oldToken;
  const newPath = newToken;
  if (!oldPath?.startsWith("a/") || !newPath?.startsWith("b/")) return null;
  return [oldPath.slice(2), newPath.slice(2)];
}

function stableId(index: number): string {
  return `anchor-${String(index + 1).padStart(4, "0")}`;
}

function pathFromMarker(line: string): string | null {
  const markerValue = line.slice(4).split("\t", 1)[0] ?? "";
  const value = decodeGitQuotedPath(markerValue) ?? markerValue;
  if (value === "/dev/null") return null;
  return value.replace(/^[ab]\//, "");
}

/** Parse a unified diff into deterministic, opaque range anchors. */
export function parseReviewStackAnchors(source: string): ReadonlyArray<ReviewStackAnchor> {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const anchors: ReviewStackAnchor[] = [];
  let fileStart = -1;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let hunkStart = -1;
  let diffHeader = "";
  let oldMarker = "";
  let newMarker = "";

  const addAnchor = (anchor: Omit<ReviewStackAnchor, "id">) => {
    anchors.push({ id: stableId(anchors.length), ...anchor });
  };

  const flushHunk = (end: number) => {
    if (hunkStart < 0) return;
    const header = HUNK_HEADER.exec(lines[hunkStart] ?? "");
    if (header && (newPath ?? oldPath)) {
      const displayOldPath = oldPath ?? newPath!;
      const displayNewPath = newPath ?? oldPath!;
      addAnchor({
        path: newPath ?? oldPath!,
        previousPath: oldPath !== newPath ? oldPath : null,
        kind: "hunk",
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? 1),
        patch: [
          diffHeader || `diff --git a/${displayOldPath} b/${displayNewPath}`,
          oldMarker || `--- ${oldPath === null ? "/dev/null" : `a/${oldPath}`}`,
          newMarker || `+++ ${newPath === null ? "/dev/null" : `b/${newPath}`}`,
          ...lines.slice(hunkStart, end),
        ]
          .join("\n")
          .trimEnd(),
      });
    }
    hunkStart = -1;
  };

  const flushFile = (end: number) => {
    flushHunk(end);
    if (fileStart < 0 || !(newPath ?? oldPath)) return;
    const fileLines = lines.slice(fileStart, end);
    const hasBinary = fileLines.some(
      (line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"),
    );
    const hasRename = fileLines.some((line) => line.startsWith("rename from "));
    const hasHunks = fileLines.some((line) => HUNK_HEADER.test(line));
    if (!hasHunks) {
      addAnchor({
        path: newPath ?? oldPath!,
        previousPath: oldPath !== newPath ? oldPath : null,
        kind: hasBinary ? "binary" : hasRename ? "rename" : "metadata",
        oldStart: null,
        oldLines: null,
        newStart: null,
        newLines: null,
        patch: fileLines.join("\n").trimEnd(),
      });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const header = parseDiffHeader(line);
    if (header) {
      flushFile(index);
      fileStart = index;
      oldPath = header[0];
      newPath = header[1];
      diffHeader = line;
      oldMarker = "";
      newMarker = "";
      continue;
    }
    if (fileStart < 0) continue;
    if (line.startsWith("--- ")) {
      oldPath = pathFromMarker(line);
      oldMarker = line;
    }
    if (line.startsWith("+++ ")) {
      newPath = pathFromMarker(line);
      newMarker = line;
    }
    if (HUNK_HEADER.test(line)) {
      flushHunk(index);
      hunkStart = index;
    }
  }
  flushFile(lines.length);
  return anchors;
}
