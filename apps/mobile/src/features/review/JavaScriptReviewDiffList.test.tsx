import { describe, expect, it, vi } from "vite-plus/test";

import { buildReviewListItems, type ReviewRenderableFile } from "./reviewModel";

vi.mock("@legendapp/list/react-native", () => ({
  LegendList: (props: {
    readonly data: ReadonlyArray<unknown>;
    readonly renderItem: (info: { item: unknown }) => unknown;
  }) => {
    const rendered = props.data.slice(0, 3).map((item) => props.renderItem({ item }));
    return { type: "LegendList", renderedCount: rendered.length, total: props.data.length };
  },
}));

function makeRenderableFile(
  input: Partial<ReviewRenderableFile> & Pick<ReviewRenderableFile, "path">,
): ReviewRenderableFile {
  return {
    id: input.path,
    cacheKey: input.path,
    previousPath: null,
    changeType: "new",
    additions: 1,
    deletions: 0,
    languageHint: null,
    additionLines: [],
    deletionLines: [],
    rows: [
      {
        kind: "hunk",
        id: "hunk-1",
        header: "@@ -1,1 +1,2 @@",
        context: null,
      },
      {
        kind: "line",
        id: "line-1",
        change: "add",
        oldLineNumber: null,
        newLineNumber: 1,
        content: "const value = 1;",
        additionTokenIndex: 0,
        deletionTokenIndex: null,
        comparison: null,
      },
    ],
    ...input,
  };
}

describe("buildReviewListItems for JavaScriptReviewDiffList", () => {
  it("renders file, hunk, and line row kinds when expanded", () => {
    const file = makeRenderableFile({ path: "src/a.ts" });
    const items = buildReviewListItems({
      files: [file],
      expandedFileIds: [file.id],
      revealedLargeFileIds: [],
    });

    expect(items.map((item) => item.kind)).toEqual(["file-header", "hunk", "line"]);
  });

  it("hides hunk and line rows when the file is collapsed", () => {
    const file = makeRenderableFile({ path: "src/b.ts" });
    const items = buildReviewListItems({
      files: [file],
      expandedFileIds: [],
      revealedLargeFileIds: [],
    });

    expect(items.map((item) => item.kind)).toEqual(["file-header"]);
  });

  it("uses a notice-style placeholder for large diffs until revealed", () => {
    const file = makeRenderableFile({
      path: "src/large.ts",
      rows: Array.from({ length: 401 }, (_, index) => ({
        kind: "line" as const,
        id: `line-${index}`,
        change: "add" as const,
        oldLineNumber: null,
        newLineNumber: index + 1,
        content: `const line${index} = ${index};`,
        additionTokenIndex: index,
        deletionTokenIndex: null,
        comparison: null,
      })),
    });

    const collapsed = buildReviewListItems({
      files: [file],
      expandedFileIds: [file.id],
      revealedLargeFileIds: [],
    });
    expect(collapsed.some((item) => item.kind === "file-suppressed")).toBe(true);

    const revealed = buildReviewListItems({
      files: [file],
      expandedFileIds: [file.id],
      revealedLargeFileIds: [file.id],
    });
    expect(revealed.some((item) => item.kind === "line")).toBe(true);
  });
});
