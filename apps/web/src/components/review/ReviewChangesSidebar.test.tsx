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

function renderSidebar(truncated = false) {
  return renderToStaticMarkup(
    <ReviewChangesSidebar
      staged={[]}
      unstaged={unstaged}
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
});
