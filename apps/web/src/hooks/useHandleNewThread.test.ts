import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { resolveNewThreadDefaults } from "./useHandleNewThread";

describe("resolveNewThreadDefaults", () => {
  it("applies the origin default only for new worktree mode", () => {
    expect(
      resolveNewThreadDefaults({
        ...DEFAULT_SERVER_SETTINGS,
        defaultThreadEnvMode: "worktree",
        newWorktreesStartFromOrigin: true,
      }),
    ).toEqual({
      envMode: "worktree",
      startFromOrigin: true,
    });

    expect(
      resolveNewThreadDefaults({
        ...DEFAULT_SERVER_SETTINGS,
        defaultThreadEnvMode: "local",
        newWorktreesStartFromOrigin: true,
      }),
    ).toEqual({
      envMode: "local",
      startFromOrigin: false,
    });
  });
});
