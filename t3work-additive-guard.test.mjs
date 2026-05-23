import { describe, expect, it } from "vitest";
import {
  candidateUpstreamCounterpartPaths,
  classifyPrefixedLocResult,
} from "./t3work-additive-guard-lib.mjs";

describe("t3work additive guard counterpart detection", () => {
  it("maps web t3work migration path to project-shell counterpart", () => {
    const result = candidateUpstreamCounterpartPaths(
      "apps/web/src/t3work/hooks/t3work-useCreateProject.ts",
      ["t3work-", "t3work."],
    );

    expect(result).toContain("apps/project-shell/src/hooks/useCreateProject.ts");
    expect(result).toContain("apps/web/src/hooks/useCreateProject.ts");
  });

  it("maps same-directory prefixed file to non-prefixed basename", () => {
    const result = candidateUpstreamCounterpartPaths("apps/server/src/t3work-server.ts", [
      "t3work-",
      "t3work.",
    ]);

    expect(result).toContain("apps/server/src/server.ts");
  });
});

describe("t3work additive guard loc classification", () => {
  it("fails oversized net-new prefixed files without counterpart", () => {
    const result = classifyPrefixedLocResult({
      filePath: "apps/web/src/t3work/t3work-NewFeature.tsx",
      loc: 250,
      locWarnThreshold: 150,
      locFailThreshold: 200,
      counterpartPath: null,
    });

    expect(result).toEqual({
      kind: "violation",
      message:
        "Prefixed file exceeds 200 LOC: apps/web/src/t3work/t3work-NewFeature.tsx (250 non-empty lines).",
    });
  });

  it("downgrades oversized migrated wrappers to warning when counterpart exists", () => {
    const result = classifyPrefixedLocResult({
      filePath: "apps/web/src/t3work/hooks/t3work-useCreateProject.ts",
      loc: 250,
      locWarnThreshold: 150,
      locFailThreshold: 200,
      counterpartPath: "apps/project-shell/src/hooks/useCreateProject.ts",
    });

    expect(result?.kind).toBe("warning");
    expect(result?.message).toContain("warning only due to upstream counterpart");
  });

  it("uses higher thresholds for additive test artifacts", () => {
    const result = classifyPrefixedLocResult({
      filePath: "apps/web/src/t3work/t3work-projectDashboardKanbanMatrix.test.ts",
      loc: 500,
      locWarnThreshold: 150,
      locFailThreshold: 200,
      counterpartPath: null,
    });

    expect(result).toEqual({
      kind: "warning",
      message:
        "Prefixed file is above 300 LOC warning threshold: apps/web/src/t3work/t3work-projectDashboardKanbanMatrix.test.ts (500 non-empty lines).",
    });
  });

  it("uses higher thresholds for additive fixture artifacts", () => {
    const result = classifyPrefixedLocResult({
      filePath: "apps/web/src/t3work/t3work-projectDashboardKanbanMatrixFixtures.tsx",
      loc: 550,
      locWarnThreshold: 150,
      locFailThreshold: 200,
      counterpartPath: null,
    });

    expect(result).toEqual({
      kind: "warning",
      message:
        "Prefixed file is above 300 LOC warning threshold: apps/web/src/t3work/t3work-projectDashboardKanbanMatrixFixtures.tsx (550 non-empty lines).",
    });
  });
});
