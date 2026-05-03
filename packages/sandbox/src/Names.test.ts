import { describe, expect, it } from "vitest";

import {
  buildSandboxName,
  buildSandboxTags,
  buildTaskBranchName,
  buildTaskMaterializationIdempotencyKey,
  sanitizeProviderNameSegment,
} from "./Names.ts";

describe("Sandbox naming helpers", () => {
  it("sanitizes provider names into stable lowercase segments", () => {
    expect(sanitizeProviderNameSegment(" Fix: Auth bug! ")).toBe("fix-auth-bug");
    expect(sanitizeProviderNameSegment("   ", "fallback")).toBe("fallback");
  });

  it("builds provider-safe Sandbox names with a bounded length", () => {
    const name = buildSandboxName({
      providerKind: "modal",
      taskId: "linear/BUG-123",
      title: "Investigate a very very very very very very long crash report",
      maxLength: 40,
    });

    expect(name).toMatch(/^sandbox-investigate-a/);
    expect(name.length).toBeLessThanOrEqual(40);
  });

  it("builds deterministic branch names and idempotency keys", () => {
    expect(buildTaskBranchName({ taskId: "task-123", title: "Fix login!" })).toBe(
      "task/fix-login-task-123",
    );
    expect(
      buildTaskMaterializationIdempotencyKey({
        providerKind: "local",
        taskId: "task-123",
        workSessionId: "work-session-1",
      }),
    ).toBe("sandbox:local:task-123:work-session-1");
  });

  it("builds provider tags for lookup and cleanup", () => {
    expect(
      buildSandboxTags({
        providerKind: "modal",
        taskId: "task-1",
        workSessionId: "work-session-1",
        projectKey: "github.com/t3tools/t3code",
      }),
    ).toMatchObject({
      "t3.sandbox.provider": "modal",
      "t3.task.id": "task-1",
      "t3.project.key": "github.com/t3tools/t3code",
    });
  });
});
