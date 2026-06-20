import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ProjectThreadBaseBranchRequiredError,
  ProjectThreadTaskRequiredError,
  validateProjectThreadCreation,
} from "./projectThreadCreationValidation";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");

describe("validateProjectThreadCreation", () => {
  it("returns structured context when a task is missing", () => {
    const error = validateProjectThreadCreation({
      environmentId,
      projectId,
      environmentMode: "local",
      branch: null,
      initialMessageText: "   ",
    });

    expect(error).toBeInstanceOf(ProjectThreadTaskRequiredError);
    expect(error).toMatchObject({
      environmentId,
      projectId,
      environmentMode: "local",
      message: "Enter a task before starting the thread.",
    });
  });

  it("returns a distinct error when a worktree branch is missing", () => {
    const error = validateProjectThreadCreation({
      environmentId,
      projectId,
      environmentMode: "worktree",
      branch: null,
      initialMessageText: "Investigate the failure",
    });

    expect(error).toBeInstanceOf(ProjectThreadBaseBranchRequiredError);
    expect(error).toMatchObject({
      environmentId,
      projectId,
      message: "Select a base branch before creating a worktree.",
    });
  });

  it("accepts valid local and worktree inputs", () => {
    expect(
      validateProjectThreadCreation({
        environmentId,
        projectId,
        environmentMode: "local",
        branch: null,
        initialMessageText: "Start a local task",
      }),
    ).toBeNull();
    expect(
      validateProjectThreadCreation({
        environmentId,
        projectId,
        environmentMode: "worktree",
        branch: "main",
        initialMessageText: "Start a worktree task",
      }),
    ).toBeNull();
  });
});
