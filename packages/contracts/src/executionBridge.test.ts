import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  TaskPullRequestEnsureRequest,
  TaskPullRequestEnsureResponse,
  TaskRuntimeSandboxLifecycleEvent,
} from "./executionBridge.ts";

const decodeTaskPullRequestEnsureRequest = Schema.decodeUnknownSync(TaskPullRequestEnsureRequest);
const decodeTaskPullRequestEnsureResponse = Schema.decodeUnknownSync(TaskPullRequestEnsureResponse);
const decodeTaskRuntimeSandboxLifecycleEvent = Schema.decodeUnknownSync(
  TaskRuntimeSandboxLifecycleEvent,
);

describe("execution bridge PR contracts", () => {
  it("decodes a task pull request ensure request", () => {
    const request = decodeTaskPullRequestEnsureRequest({
      taskId: "task-123",
      workSessionId: "work-session-123",
      sandboxId: "sandbox-123",
      environmentId: "env-123",
      branch: "task/fix-checkout",
      worktreePath: "/tmp/worktrees/task-fix-checkout",
      project: {
        githubOwner: "acme",
        githubRepo: "app",
        defaultBranch: "main",
      },
      title: "Fix checkout regression",
      body: "Created by the AI Engineer task intake flow.",
      idempotencyKey: "task-123:work-session-123:task/fix-checkout",
    });

    expect(request.project.githubOwner).toBe("acme");
    expect(request.sandboxId).toBe("sandbox-123");
    expect(request.branch).toBe("task/fix-checkout");
  });

  it("decodes sandbox lifecycle events separately from agent lifecycle events", () => {
    const event = decodeTaskRuntimeSandboxLifecycleEvent({
      eventId: "event-123",
      taskId: "task-123",
      workSessionId: "work-session-123",
      sandboxId: "sandbox-123",
      providerKind: "modal",
      status: "ready",
      occurredAt: "2026-05-02T16:00:00.000Z",
      providerRef: {
        providerKind: "modal",
        externalId: "modal-sandbox-123",
        appName: "t3-task-runtime",
      },
    });

    expect(event.providerKind).toBe("modal");
    expect(event.status).toBe("ready");
  });

  it("decodes waiting, created, existing, and failed responses", () => {
    expect(
      decodeTaskPullRequestEnsureResponse({
        taskId: "task-123",
        workSessionId: "work-session-123",
        status: "waiting_for_changes",
        checkedAt: "2026-05-02T16:00:00.000Z",
        summary: "No changes to publish yet.",
      }).status,
    ).toBe("waiting_for_changes");

    for (const status of ["created", "existing"] as const) {
      const response = decodeTaskPullRequestEnsureResponse({
        taskId: "task-123",
        workSessionId: "work-session-123",
        status,
        checkedAt: "2026-05-02T16:01:00.000Z",
        pullRequest: {
          owner: "acme",
          repo: "app",
          number: 42,
          url: "https://github.com/acme/app/pull/42",
          headBranch: "task/fix-checkout",
          baseBranch: "main",
          title: "Fix checkout regression",
          draft: true,
        },
      });

      expect(response.pullRequest?.number).toBe(42);
    }

    expect(
      decodeTaskPullRequestEnsureResponse({
        taskId: "task-123",
        workSessionId: "work-session-123",
        status: "failed",
        checkedAt: "2026-05-02T16:02:00.000Z",
        summary: "GitHub CLI is unavailable.",
      }).status,
    ).toBe("failed");
  });

  it("rejects empty branch and unknown response statuses", () => {
    expect(() =>
      decodeTaskPullRequestEnsureRequest({
        taskId: "task-123",
        workSessionId: "work-session-123",
        branch: " ",
        worktreePath: "/tmp/worktrees/task-fix-checkout",
        project: {
          githubOwner: "acme",
          githubRepo: "app",
          defaultBranch: "main",
        },
        title: "Fix checkout regression",
        idempotencyKey: "task-123:work-session-123",
      }),
    ).toThrow();

    expect(() =>
      decodeTaskPullRequestEnsureResponse({
        taskId: "task-123",
        workSessionId: "work-session-123",
        status: "done",
        checkedAt: "2026-05-02T16:03:00.000Z",
      }),
    ).toThrow();
  });
});
