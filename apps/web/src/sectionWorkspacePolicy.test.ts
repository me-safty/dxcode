import { describe, expect, it } from "vite-plus/test";

import {
  isManagedSectionWorkspace,
  isThreadWorkspaceReady,
  normalizeNewThreadWorkspaceSeed,
} from "./sectionWorkspacePolicy";

describe("sectionWorkspacePolicy", () => {
  it("clears inherited workspace state for a new section thread", () => {
    expect(
      normalizeNewThreadWorkspaceSeed("section", {
        branch: "section-thread/previous",
        worktreePath: "/tmp/sections/previous",
        envMode: "worktree",
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });

  it("preserves workspace state for regular projects", () => {
    const seed = {
      branch: "feature/refactor",
      worktreePath: "/tmp/worktrees/refactor",
      envMode: "worktree" as const,
    };

    expect(normalizeNewThreadWorkspaceSeed("project", seed)).toBe(seed);
  });

  it("identifies only section workspaces as server-managed", () => {
    expect(isManagedSectionWorkspace("section")).toBe(true);
    expect(isManagedSectionWorkspace("project")).toBe(false);
    expect(isManagedSectionWorkspace(undefined)).toBe(false);
  });

  it("keeps section workspace actions locked until the server worktree is available", () => {
    expect(
      isThreadWorkspaceReady({
        hasProject: true,
        hasServerThread: false,
        projectKind: "section",
        worktreePath: "/tmp/inherited-worktree",
      }),
    ).toBe(false);
    expect(
      isThreadWorkspaceReady({
        hasProject: true,
        hasServerThread: true,
        projectKind: "section",
        worktreePath: "/tmp/managed-worktree",
      }),
    ).toBe(true);
  });
});
