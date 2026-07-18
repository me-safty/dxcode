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
});
