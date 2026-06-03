import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ExecutionTarget, ProjectLocation } from "./executionTarget.ts";

const decodeExecutionTarget = Schema.decodeUnknownSync(ExecutionTarget);
const decodeProjectLocation = Schema.decodeUnknownSync(ProjectLocation);

describe("execution target contracts", () => {
  it("decodes local execution targets", () => {
    expect(decodeExecutionTarget({ kind: "local" })).toEqual({
      kind: "local",
    });
  });

  it("decodes WSL project locations", () => {
    expect(
      decodeProjectLocation({
        kind: "wsl",
        distroName: "Ubuntu",
        path: "/home/me/project",
      }),
    ).toEqual({
      kind: "wsl",
      distroName: "Ubuntu",
      path: "/home/me/project",
    });
  });
});
