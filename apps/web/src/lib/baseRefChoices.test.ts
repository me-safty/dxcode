import { describe, expect, it } from "vite-plus/test";
import type { VcsRef } from "@t3tools/contracts";
import { buildBaseRefChoices } from "./baseRefChoices";

function ref(name: string, remoteName?: string): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: remoteName !== undefined,
    ...(remoteName ? { remoteName } : {}),
    worktreePath: null,
  };
}

describe("buildBaseRefChoices", () => {
  it("pairs matching local and remote branches and prefers origin", () => {
    const choices = buildBaseRefChoices(
      [ref("main")],
      [ref("upstream/main", "upstream"), ref("origin/main", "origin")],
    );

    expect(choices).toEqual([
      expect.objectContaining({
        label: "main",
        local: expect.objectContaining({ name: "main" }),
        remote: expect.objectContaining({ name: "origin/main" }),
      }),
      expect.objectContaining({
        label: "upstream/main",
        local: null,
        remote: expect.objectContaining({ name: "upstream/main" }),
      }),
    ]);
  });
});
