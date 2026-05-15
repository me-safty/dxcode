import { describe, expect, it } from "vitest";

import { resolveMentionedProjectAlias } from "./projectRouting.ts";

describe("task intake project routing", () => {
  it("detects explicit nextcard mentions", () => {
    expect(resolveMentionedProjectAlias("please fix this in nextcard")).toBe("nextcard");
    expect(resolveMentionedProjectAlias("NEXTCARD smoke task")).toBe("nextcard");
  });

  it("detects explicit t3code mentions", () => {
    expect(resolveMentionedProjectAlias("can you inspect t3code?")).toBe("t3code");
    expect(resolveMentionedProjectAlias("T3CODE bridge bug")).toBe("t3code");
  });

  it("ignores aliases embedded inside other words", () => {
    expect(resolveMentionedProjectAlias("nextcardinal should not match")).toBeNull();
    expect(resolveMentionedProjectAlias("pret3code should not match")).toBeNull();
  });

  it("uses the first explicit alias when both are mentioned", () => {
    expect(resolveMentionedProjectAlias("nextcard compare with t3code")).toBe("nextcard");
    expect(resolveMentionedProjectAlias("t3code compare with nextcard")).toBe("t3code");
  });
});
