import { describe, expect, it } from "vitest";

import { buildGrokAcpSpawnInput } from "./GrokAcpSupport.ts";

describe("buildGrokAcpSpawnInput", () => {
  it("builds the default Grok Build ACP command", () => {
    expect(buildGrokAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "grok",
      args: ["--agent", "build", "agent", "stdio"],
      cwd: "/tmp/project",
    });
  });

  it("uses the configured binary path when present", () => {
    expect(
      buildGrokAcpSpawnInput(
        {
          binaryPath: "/usr/local/bin/grok",
        },
        "/tmp/project",
      ),
    ).toEqual({
      command: "/usr/local/bin/grok",
      args: ["--agent", "build", "agent", "stdio"],
      cwd: "/tmp/project",
    });
  });

  it("inherits a dedicated worktree cwd without passing Grok's own worktree flag", () => {
    const spawn = buildGrokAcpSpawnInput(
      {
        binaryPath: "grok",
      },
      "/repo/.t3/worktrees/feature-branch",
    );

    expect(spawn.cwd).toBe("/repo/.t3/worktrees/feature-branch");
    expect(spawn.args).toEqual(["--agent", "build", "agent", "stdio"]);
    expect(spawn.args).not.toContain("--worktree");
  });
});
