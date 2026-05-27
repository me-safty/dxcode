import { describe, expect, it } from "vitest";
import type { ProjectShellProject } from "@t3tools/project-context";

import { buildT3workSidecarRecipeQuickStarts } from "~/t3work/t3work-sidecarRecipes";

function createProject(profileId: string): ProjectShellProject {
  return {
    id: "project-alpha" as ProjectShellProject["id"],
    title: "Project Alpha",
    source: {
      provider: "atlassian",
      externalProjectId: "PA",
      raw: {
        agentSetup: {
          profileId,
        },
      },
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("buildT3workSidecarRecipeQuickStarts", () => {
  it("surfaces engineering-biased recipes for the engineering copilot profile", () => {
    const quickStarts = buildT3workSidecarRecipeQuickStarts({
      surface: "workitem.detail.sidepanel",
      project: createProject("engineering-copilot"),
      profileId: "engineering-copilot",
      selectedWorkLabel: "PROJ-123",
      resourceKind: "ticket",
      availableContextKeys: ["project.summary", "ticket.summary"],
    });

    expect(quickStarts[0]?.id).toBe("technical-implementation-plan");
    expect(quickStarts.some((recipe) => recipe.id === "create-qa-test-plan")).toBe(false);
  });

  it("surfaces product-oriented updates on the project dashboard for product partner", () => {
    const quickStarts = buildT3workSidecarRecipeQuickStarts({
      surface: "project.dashboard",
      project: createProject("product-partner"),
      profileId: "product-partner",
      selectedWorkLabel: "Project Alpha",
      availableContextKeys: ["project.summary"],
    });

    expect(quickStarts.map((recipe) => recipe.id)).toContain("stakeholder-update");
    expect(quickStarts.some((recipe) => recipe.id === "technical-implementation-plan")).toBe(false);
  });
});
