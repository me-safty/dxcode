import { describe, expect, it } from "vitest";

import { parseWorkspaceRouteSearch, stripWorkspaceRouteSearchParams } from "./workspaceRouteSearch";

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
