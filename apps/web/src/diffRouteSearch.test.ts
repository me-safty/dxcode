import { describe, expect, it } from "vite-plus/test";

import { parseDiffRouteSearch } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("parses the unstaged diff scope without a selected turn", () => {
    expect(parseDiffRouteSearch({ diff: "1", diffScope: "unstaged" })).toEqual({
      diff: "1",
      diffScope: "unstaged",
    });
  });

  it("drops the git diff scope when a turn is selected", () => {
    expect(
      parseDiffRouteSearch({ diff: "1", diffScope: "unstaged", diffTurnId: "turn-1" }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops unknown diff scopes", () => {
    expect(parseDiffRouteSearch({ diff: "1", diffScope: "staged" })).toEqual({ diff: "1" });
  });

  it("parses a branch comparison target", () => {
    expect(parseDiffRouteSearch({ diff: "1", diffBaseRef: "origin/main" })).toEqual({
      diff: "1",
      diffBaseRef: "origin/main",
    });
  });

  it("drops the branch target for unstaged and turn diffs", () => {
    expect(
      parseDiffRouteSearch({ diff: "1", diffScope: "unstaged", diffBaseRef: "origin/main" }),
    ).toEqual({ diff: "1", diffScope: "unstaged" });
    expect(
      parseDiffRouteSearch({ diff: "1", diffTurnId: "turn-1", diffBaseRef: "origin/main" }),
    ).toEqual({ diff: "1", diffTurnId: "turn-1" });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });
});
