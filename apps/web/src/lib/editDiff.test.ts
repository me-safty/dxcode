import { describe, expect, it } from "vite-plus/test";
import { extractEditDiff } from "./editDiff";

describe("extractEditDiff", () => {
  it("uses OpenCode's metadata.diff verbatim", () => {
    const diff = [
      "Index: /repo/packages/convex/convex.json",
      "===================================================================",
      "--- /repo/packages/convex/convex.json",
      "+++ /repo/packages/convex/convex.json",
      "@@ -1,3 +1,3 @@",
      " {",
      '-\t"functions": "src/convex/"',
      '+\t"functions": "convex/"',
      " }",
    ].join("\n");
    const result = extractEditDiff({
      itemType: "file_change",
      data: { tool: "edit", state: { metadata: { diff } } },
    });
    expect(result).toBe(diff);
  });

  it("adds file headers to a Codex update hunk", () => {
    const result = extractEditDiff({
      itemType: "file_change",
      data: {
        item: {
          changes: [
            {
              diff: "@@ -1 +1,2 @@\n Random note created during harness testing.\n+Edited once more.\n",
              kind: { type: "update", move_path: null },
              path: "/repo/docs/random-note.txt",
            },
          ],
        },
      },
    });
    expect(result).toContain("--- a/repo/docs/random-note.txt");
    expect(result).toContain("+++ b/repo/docs/random-note.txt");
    expect(result).toContain("@@ -1 +1,2 @@");
    expect(result).toContain("+Edited once more.");
  });

  it("synthesizes an add hunk from Codex raw content", () => {
    const result = extractEditDiff({
      itemType: "file_change",
      data: {
        item: {
          changes: [
            {
              diff: "line one\nline two\n",
              kind: { type: "add" },
              path: "/repo/new.txt",
            },
          ],
        },
      },
    });
    expect(result).toContain("--- /dev/null");
    expect(result).toContain("+++ b/repo/new.txt");
    expect(result).toContain("@@ -0,0 +1,2 @@");
    expect(result).toContain("+line one");
    expect(result).toContain("+line two");
  });

  it("synthesizes a Claude diff from old_string/new_string", () => {
    const result = extractEditDiff({
      itemType: "file_change",
      data: {
        tool: "Edit",
        input: {
          file_path: "/repo/src/app.ts",
          old_string: "const x = 1;\n",
          new_string: "const x = 2;\n",
        },
      },
    });
    expect(result).toBeDefined();
    expect(result).toContain("-const x = 1;");
    expect(result).toContain("+const x = 2;");
  });

  it("returns undefined when there is no diff data", () => {
    expect(extractEditDiff({ itemType: "file_change", data: { tool: "edit" } })).toBeUndefined();
    expect(extractEditDiff(null)).toBeUndefined();
  });

  it("returns undefined for a Claude no-op edit (old equals new)", () => {
    const result = extractEditDiff({
      itemType: "file_change",
      data: {
        input: { file_path: "/repo/a.ts", old_string: "same\n", new_string: "same\n" },
      },
    });
    expect(result).toBeUndefined();
  });
});
