import type { ReviewChangedFile } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ReviewChangesSidebar } from "./ReviewChangesSidebar";

const unstaged: ReadonlyArray<ReviewChangedFile> = [
  {
    path: "src/changed.ts",
    previousPath: null,
    kind: "modified",
    insertions: 2,
    deletions: 1,
  },
  {
    path: "src/new.ts",
    previousPath: null,
    kind: "untracked",
    insertions: 4,
    deletions: 0,
  },
];

const statusFiles: ReadonlyArray<ReviewChangedFile> = [
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
].map((kind, index) => ({
  path: `src/status-${index}.ts`,
  previousPath: null,
  kind: kind as ReviewChangedFile["kind"],
  insertions: 0,
  deletions: 0,
}));

function renderSidebar(truncated = false, files: ReadonlyArray<ReviewChangedFile> = unstaged) {
  return renderToStaticMarkup(
    <ReviewChangesSidebar
      staged={[]}
      unstaged={files}
      truncated={truncated}
      selection={null}
      pendingPaths={new Set()}
      theme="dark"
      onSelectAll={vi.fn()}
      onSelectFile={vi.fn()}
      onStageChanges={vi.fn()}
      onUnstageChanges={vi.fn()}
      onDiscardChanges={vi.fn()}
    />,
  );
}

describe("ReviewChangesSidebar", () => {
  it("presents view all changes as the selected primary sidebar action", () => {
    const html = renderSidebar();

    expect(html).toContain("View all changes");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("lucide-file-diff");
    expect(html).toContain(">+6</span>");
    expect(html).toContain(">-1</span>");
  });

  it("hides the aggregate line changes when both totals are zero", () => {
    const html = renderSidebar(false, statusFiles);

    expect(html).not.toContain(">+0</span>");
    expect(html).not.toContain(">-0</span>");
  });

  it("shows a bulk discard action for unstaged files", () => {
    const html = renderSidebar();

    expect(html).toContain('aria-label="Discard all unstaged changes"');
    expect(html).not.toContain('aria-label="Discard all unstaged changes" disabled=""');
  });

  it("disables bulk discard when the manifest is truncated", () => {
    const html = renderSidebar(true);

    expect(html).toContain('aria-label="Discard all unstaged changes" disabled=""');
  });

  it("shows a colored Git status letter after each file icon", () => {
    const html = renderSidebar(false, statusFiles);

    for (const [label, letter] of [
      ["modified", "M"],
      ["added", "A"],
      ["deleted", "D"],
      ["renamed", "R"],
      ["copied", "C"],
      ["untracked", "U"],
      ["conflicted", "!"],
    ]) {
      expect(html).toContain(`aria-label="Git status: ${label}"`);
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain(`>${letter}</span>`);
    }
  });
});
