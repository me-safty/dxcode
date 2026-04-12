import { describe, expect, it } from "vitest";

import {
  clearWorkspaceRouteSearch,
  mergeWorkspaceRouteSearch,
  parseWorkspaceRouteSearch,
  stripWorkspaceRouteSearchParams,
} from "./workspaceRouteSearch";

describe("parseWorkspaceRouteSearch", () => {
  it("keeps a valid panel value", () => {
    const parsed = parseWorkspaceRouteSearch({
      panel: "diff",
      panelTurnId: "turn-1",
      panelFilePath: "src/app.ts",
      unrelated: "keep-me",
    });

    expect(parsed).toEqual({
      panel: "diff",
      panelTurnId: "turn-1",
      panelFilePath: "src/app.ts",
      unrelated: "keep-me",
    });
  });

  it("drops whitespace-only panel values", () => {
    const parsed = parseWorkspaceRouteSearch({
      panel: "  ",
      panelTurnId: "turn-1",
    });

    expect(parsed).toEqual({
      panelTurnId: "turn-1",
    });
  });
});

describe("stripWorkspaceRouteSearchParams", () => {
  it("removes all provided workspace keys while preserving unrelated search params", () => {
    expect(
      stripWorkspaceRouteSearchParams(
        {
          panel: "diff",
          panelTurnId: "turn-1",
          panelFilePath: "src/app.ts",
          unrelated: "keep-me",
        },
        ["panel", "panelTurnId", "panelFilePath"],
      ),
    ).toEqual({
      unrelated: "keep-me",
    });
  });
});

describe("workspace panel search helpers", () => {
  it("clears known workspace panel params while keeping unrelated keys", () => {
    expect(
      clearWorkspaceRouteSearch({
        panel: "diff",
        panelTurnId: "turn-1",
        panelFilePath: "src/app.ts",
        unrelated: "keep-me",
      }),
    ).toEqual({
      unrelated: "keep-me",
    });
  });

  it("replaces stale panel params when merging a new panel state", () => {
    expect(
      mergeWorkspaceRouteSearch(
        {
          panel: "diff",
          panelTurnId: "turn-1",
          panelFilePath: "src/app.ts",
          unrelated: "keep-me",
        },
        {
          panel: "diff",
        },
      ),
    ).toEqual({
      panel: "diff",
      unrelated: "keep-me",
    });
  });
});
