import { describe, expect, it } from "vitest";

import { shouldBlockBackNavigationAction } from "./navigationBlocking";

describe("shouldBlockBackNavigationAction", () => {
  it("blocks browser back navigation", () => {
    expect(shouldBlockBackNavigationAction("BACK")).toBe(true);
  });

  it.each(["PUSH", "REPLACE", "FORWARD", "GO"])("allows %s navigation", (action) => {
    expect(shouldBlockBackNavigationAction(action)).toBe(false);
  });
});
