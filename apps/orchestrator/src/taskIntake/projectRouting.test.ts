import { describe, expect, it } from "vitest";

import { resolveMentionedProject } from "./projectRouting.ts";

const projects = [
  { githubRepo: "example-app", id: "project-example-app" },
  { githubRepo: "t3code", id: "project-t3code" },
] as const;

describe("task intake project routing", () => {
  it("detects explicit project repo mentions", () => {
    expect(resolveMentionedProject("please fix this in example-app", projects)?.id).toBe(
      "project-example-app",
    );
    expect(resolveMentionedProject("can you inspect T3CODE?", projects)?.id).toBe("project-t3code");
  });

  it("ignores repo names embedded inside other words", () => {
    expect(resolveMentionedProject("example-appinal should not match", projects)).toBeNull();
    expect(resolveMentionedProject("pret3code should not match", projects)).toBeNull();
  });

  it("uses the first matching project when multiple projects are mentioned", () => {
    expect(resolveMentionedProject("example-app compare with t3code", projects)?.id).toBe(
      "project-example-app",
    );
    expect(resolveMentionedProject("t3code compare with example-app", projects)?.id).toBe(
      "project-example-app",
    );
  });
});
