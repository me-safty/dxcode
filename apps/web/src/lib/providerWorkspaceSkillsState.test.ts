import type { ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolvePendingProviderWorkspaceSkills,
  resolveProviderWorkspaceSkills,
} from "./providerWorkspaceSkillsState";

function skill(name: string): ServerProviderSkill {
  return {
    name,
    path: `/skills/${name}/SKILL.md`,
    enabled: true,
  };
}

describe("resolvePendingProviderWorkspaceSkills", () => {
  it("preserves current skills while refreshing the same workspace key", () => {
    const currentSkills = [skill("repo-local")];

    expect(
      resolvePendingProviderWorkspaceSkills({
        currentKey: "environment:codex:/repo",
        nextKey: "environment:codex:/repo",
        currentSkills,
      }),
    ).toBe(currentSkills);
  });

  it("does not expose previous or snapshot skills while a different workspace key is pending", () => {
    const pendingSkills = resolvePendingProviderWorkspaceSkills({
      currentKey: "environment:codex:/old-repo",
      nextKey: "environment:codex:/new-repo",
      currentSkills: [skill("old-repo-skill"), skill("snapshot-skill")],
    });

    expect(pendingSkills).toEqual([]);
  });
});

describe("resolveProviderWorkspaceSkills", () => {
  it("uses loaded skills as soon as workspace data is available", () => {
    const loadedSkills = [skill("repo-local")];

    expect(
      resolveProviderWorkspaceSkills({
        nextKey: "environment:codex:/repo",
        nextSkills: loadedSkills,
        isPending: false,
        currentKey: null,
        currentSkills: [],
      }),
    ).toBe(loadedSkills);
  });

  it("preserves current skills while refreshing the same workspace", () => {
    const currentSkills = [skill("repo-local")];

    expect(
      resolveProviderWorkspaceSkills({
        nextKey: "environment:codex:/repo",
        nextSkills: null,
        isPending: true,
        currentKey: "environment:codex:/repo",
        currentSkills,
      }),
    ).toBe(currentSkills);
  });

  it("clears current skills while loading a different workspace", () => {
    expect(
      resolveProviderWorkspaceSkills({
        nextKey: "environment:codex:/new-repo",
        nextSkills: null,
        isPending: true,
        currentKey: "environment:codex:/old-repo",
        currentSkills: [skill("old-repo-skill")],
      }),
    ).toEqual([]);
  });

  it("clears skills after a non-pending query with no data", () => {
    expect(
      resolveProviderWorkspaceSkills({
        nextKey: "environment:codex:/repo",
        nextSkills: null,
        isPending: false,
        currentKey: "environment:codex:/repo",
        currentSkills: [skill("repo-local")],
      }),
    ).toEqual([]);
  });
});
