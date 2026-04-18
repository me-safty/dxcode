import { describe, expect, it } from "vitest";
import {
  deriveWorkspaceArtifacts,
  describeWorkspaceArtifact,
  selectRecentArtifactOutputs,
} from "./workspaceArtifacts";

describe("describeWorkspaceArtifact", () => {
  it("recognizes the brief's core knowledge-work formats", () => {
    expect(describeWorkspaceArtifact("reports/q2-summary.md")).toMatchObject({
      category: "note",
      typeLabel: "Markdown",
      previewKind: "text",
    });
    expect(describeWorkspaceArtifact("reports/final.pdf")).toMatchObject({
      category: "pdf",
      typeLabel: "PDF",
      previewKind: "native",
    });
    expect(describeWorkspaceArtifact("reports/board-deck.pptx")).toMatchObject({
      category: "presentation",
      typeLabel: "Presentation",
      previewKind: "native",
    });
    expect(describeWorkspaceArtifact("reports/model.xlsx")).toMatchObject({
      category: "spreadsheet",
      typeLabel: "Spreadsheet",
      previewKind: "native",
    });
    expect(describeWorkspaceArtifact("reports/brief.docx")).toMatchObject({
      category: "document",
      typeLabel: "Document",
      previewKind: "native",
    });
  });
});

describe("deriveWorkspaceArtifacts", () => {
  it("prefers checkpoint metadata and backfills activity-only files", () => {
    const artifacts = deriveWorkspaceArtifacts({
      turnDiffSummaries: [
        {
          turnId: "turn-2" as never,
          completedAt: "2026-04-18T10:00:00.000Z",
          files: [
            {
              path: "outputs/analysis.md",
              kind: "new",
              additions: 48,
              deletions: 0,
            },
          ],
        },
      ],
      workEntries: [
        {
          id: "work-1",
          createdAt: "2026-04-18T10:01:00.000Z",
          label: "Updated files",
          tone: "tool",
          changedFiles: ["outputs/analysis.md", "outputs/appendix.pdf"],
        },
      ],
    });

    expect(artifacts).toEqual([
      expect.objectContaining({
        path: "outputs/analysis.md",
        status: "Created",
        additions: 48,
        deletions: 0,
        turnId: "turn-2",
      }),
      expect.objectContaining({
        path: "outputs/appendix.pdf",
        status: "Updated",
        additions: 0,
        deletions: 0,
      }),
    ]);
  });

  it("sorts friendlier knowledge-work files ahead of code paths", () => {
    const artifacts = deriveWorkspaceArtifacts({
      turnDiffSummaries: [
        {
          turnId: "turn-3" as never,
          completedAt: "2026-04-18T09:00:00.000Z",
          files: [
            { path: "src/app.tsx", kind: "change", additions: 6, deletions: 2 },
            { path: "deliverables/report.docx", kind: "new", additions: 0, deletions: 0 },
          ],
        },
      ],
      workEntries: [],
    });

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "deliverables/report.docx",
      "src/app.tsx",
    ]);
  });
});

describe("selectRecentArtifactOutputs", () => {
  it("returns the most recent files first", () => {
    const recent = selectRecentArtifactOutputs(
      deriveWorkspaceArtifacts({
        turnDiffSummaries: [
          {
            turnId: "turn-1" as never,
            completedAt: "2026-04-18T08:00:00.000Z",
            files: [{ path: "notes/brief.md", kind: "new", additions: 1, deletions: 0 }],
          },
          {
            turnId: "turn-2" as never,
            completedAt: "2026-04-18T10:00:00.000Z",
            files: [{ path: "notes/final.md", kind: "new", additions: 1, deletions: 0 }],
          },
        ],
        workEntries: [],
      }),
      1,
    );

    expect(recent).toHaveLength(1);
    expect(recent[0]?.path).toBe("notes/final.md");
  });
});
