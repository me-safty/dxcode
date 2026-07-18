import { describe, expect, it } from "vite-plus/test";
import { scopeProject, type EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, OrchestrationProjectShell, type ProjectScript } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import {
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectsSharingActions,
  projectScriptIdFromCommand,
  sharedProjectScripts,
  updateProjectScriptsWithRollback,
} from "./projectScripts";

const decodeProjectShell = Schema.decodeUnknownSync(OrchestrationProjectShell);

describe("projectScripts helpers", () => {
  it("shares actions between worktrees of the same repository unless disabled", () => {
    const action = {
      id: "test",
      name: "Test",
      command: "vp test",
      icon: "test" as const,
      runOnWorktreeCreate: false,
    };
    const makeProject = (
      id: string,
      canonicalKey: string,
      scripts: (typeof action)[] = [],
      environmentId = "local",
    ): EnvironmentProject =>
      scopeProject(
        EnvironmentId.make(environmentId),
        decodeProjectShell({
          id,
          title: id,
          workspaceRoot: `/repo/${id}`,
          repositoryIdentity: {
            canonicalKey,
            locator: { source: "git-remote", remoteName: "origin", remoteUrl: canonicalKey },
          },
          defaultModelSelection: null,
          scripts,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    const primary = makeProject("primary", "github.com/acme/repo", [action]);
    const worktree = makeProject("worktree", "github.com/acme/repo");
    const other = makeProject("other", "github.com/acme/other");
    const remoteClone = makeProject("remote", "github.com/acme/repo", [], "ssh");

    const projects = [primary, worktree, other, remoteClone];
    expect(projectsSharingActions(worktree, projects, true)).toEqual([primary, worktree]);
    expect(sharedProjectScripts(worktree, projects, true)).toEqual([action]);
    expect(sharedProjectScripts(worktree, projects, false)).toEqual([]);
  });

  it("rolls back successful shared-action updates when a sibling fails", async () => {
    const action = {
      id: "test",
      name: "Test",
      command: "vp test",
      icon: "test" as const,
      runOnWorktreeCreate: false,
    };
    const first = {
      environmentId: EnvironmentId.make("local"),
      id: decodeProjectShell({
        id: "first",
        title: "First",
        workspaceRoot: "/repo/first",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }).id,
      scripts: [] as const,
    };
    const second = {
      ...first,
      id: decodeProjectShell({
        id: "second",
        title: "Second",
        workspaceRoot: "/repo/second",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }).id,
    };
    const calls: Array<{ id: string; scripts: ReadonlyArray<ProjectScript> }> = [];
    const result = await updateProjectScriptsWithRollback({
      projects: [first, second],
      nextScripts: [action],
      update: async (project, scripts) => {
        calls.push({ id: project.id, scripts });
        return project.id === second.id && scripts.length > 0 ? "failure" : "success";
      },
      isFailure: (value) => value === "failure",
    });

    expect(result).toEqual(["success", "failure"]);
    expect(calls).toEqual([
      { id: first.id, scripts: [action] },
      { id: second.id, scripts: [action] },
      { id: first.id, scripts: [] },
    ]);
  });

  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary and setup scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree-a",
    });
  });

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        T3CODE_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
      },
    });

    expect(env.T3CODE_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
  });
});
