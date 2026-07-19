import { describe, expect, it } from "vite-plus/test";

import { parseReviewStackAnchors } from "./Anchors.ts";

describe("parseReviewStackAnchors", () => {
  it("parses multiple hunks with add/delete line metadata", () => {
    const anchors = parseReviewStackAnchors(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,3 @@",
        "-old",
        "+new",
        "+added",
        " keep",
        "@@ -10,2 +11,0 @@",
        "-gone",
        "-also gone",
      ].join("\n"),
    );

    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({
      id: "anchor-0001",
      path: "src/a.ts",
      kind: "hunk",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
    });
    expect(anchors[1]).toMatchObject({ oldStart: 10, oldLines: 2, newStart: 11, newLines: 0 });
    expect(anchors[0]?.patch).toContain("diff --git a/src/a.ts b/src/a.ts");
  });

  it("parses rename, binary, metadata-only, and CRLF diffs", () => {
    const anchors = parseReviewStackAnchors(
      [
        "diff --git a/old.ts b/new.ts",
        "similarity index 100%",
        "rename from old.ts",
        "rename to new.ts",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
        "diff --git a/script.sh b/script.sh",
        "old mode 100644",
        "new mode 100755",
      ].join("\r\n"),
    );

    expect(anchors.map(({ kind }) => kind)).toEqual(["rename", "binary", "metadata"]);
    expect(anchors[0]).toMatchObject({ path: "new.ts", previousPath: "old.ts" });
    expect(anchors.every(({ patch }) => !patch.includes("\r"))).toBe(true);
  });

  it("parses untracked additions and empty input", () => {
    const anchors = parseReviewStackAnchors(
      [
        "diff --git a/new.txt b/new.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.txt",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
      ].join("\n"),
    );
    expect(anchors[0]).toMatchObject({
      path: "new.txt",
      previousPath: null,
      oldStart: 0,
      oldLines: 0,
      newLines: 2,
    });
    expect(parseReviewStackAnchors("")).toEqual([]);
  });

  it("decodes Git C-quoted UTF-8 paths", () => {
    const anchors = parseReviewStackAnchors(
      [
        'diff --git "a/\\303\\251.ts" "b/\\303\\251.ts"',
        '--- "a/\\303\\251.ts"',
        '+++ "b/\\303\\251.ts"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ path: "é.ts", previousPath: null });
    expect(anchors[0]?.patch).toContain('diff --git "a/\\303\\251.ts" "b/\\303\\251.ts"');
  });

  it("parses diff headers when only one rename path is quoted", () => {
    const oldQuoted = parseReviewStackAnchors(
      [
        'diff --git "a/\\303\\251.ts" b/plain.ts',
        "similarity index 100%",
        'rename from "\\303\\251.ts"',
        "rename to plain.ts",
      ].join("\n"),
    );
    const newQuoted = parseReviewStackAnchors(
      [
        'diff --git a/plain.ts "b/\\303\\251.ts"',
        "similarity index 100%",
        "rename from plain.ts",
        'rename to "\\303\\251.ts"',
      ].join("\n"),
    );

    expect(oldQuoted[0]).toMatchObject({ path: "plain.ts", previousPath: "é.ts" });
    expect(newQuoted[0]).toMatchObject({ path: "é.ts", previousPath: "plain.ts" });
  });
});
