import { describe, expect, it } from "vitest";

import { applyNeuropharmPromptPolicy } from "./NeuropharmPromptPolicy.ts";

describe("applyNeuropharmPromptPolicy", () => {
  it("injects the neuropharmacology system prompt once", () => {
    const first = applyNeuropharmPromptPolicy("Analyze modafinil.");
    const second = applyNeuropharmPromptPolicy(first);

    expect(first).toContain("Neuropharm Research");
    expect(first).toContain("built-in basics pack");
    expect(first).toContain("AF710B / AF-710B / ANAVEX 3-71");
    expect(first).toContain("Do not use shell commands such as rg, find, ls");
    expect(first).toContain("Do not wait for the user to choose a visible domain/menu");
    expect(first).toContain("under 1.5 GB");
    expect(first).toContain("BindingDB all-2D/all-3D SDF archives are not part");
    expect(first).toContain("built-in workbook schema");
    expect(first).toContain("Build graph artifacts from local receptor/database rows first");
    expect(first).toContain("For target_network, each datum is a target node");
    expect(first).toContain("plain json");
    expect(first).toContain("receptor_selectivity_radar and admet_radar render");
    expect(first).toContain("interaction_risk_heatmap and task_domain_matrix render");
    expect(first).toContain("Analyze modafinil.");
    expect(second).toBe(first);
  });
});
