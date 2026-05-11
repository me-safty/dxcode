import { afterEach, describe, expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";

import { createT3ExecutionBridgeClient } from "./client.ts";

const decodeThreadId = Schema.decodeUnknownSync(ThreadId);

describe("createT3ExecutionBridgeClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the default bridge base URL when no override is provided", async () => {
    vi.stubEnv("T3_EXECUTION_BRIDGE_BASE_URL", "https://bridge.example.com/");
    vi.stubEnv("T3_EXECUTION_BRIDGE_SHARED_SECRET", "shared-secret");
    const fetchMock = vi.fn(async () =>
      Response.json({
        executionRunId: "run-1",
        t3ThreadId: "thread-1",
        acceptedAt: "2026-05-03T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createT3ExecutionBridgeClient();
    await client.continueExecutionRun({
      controlThreadId: "task-1",
      executionRunId: "run-1",
      t3ThreadId: decodeThreadId("thread-1"),
      prompt: "continue",
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bridge.example.com/api/execution/runs/continue",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer shared-secret" }),
      }),
    );
  });

  it("uses an override bridge base URL for routed runtime calls", async () => {
    vi.stubEnv("T3_EXECUTION_BRIDGE_BASE_URL", "https://control.example.com");
    vi.stubEnv("T3_EXECUTION_BRIDGE_SHARED_SECRET", "shared-secret");
    const fetchMock = vi.fn(async () =>
      Response.json({
        taskId: "task-1",
        workSessionId: "work-session-1",
        status: "waiting_for_changes",
        checkedAt: "2026-05-03T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createT3ExecutionBridgeClient({
      baseUrl: "https://runtime.example.com/",
    });
    await client.ensureTaskPullRequest({
      taskId: "task-1",
      workSessionId: "work-session-1",
      branch: "task/example",
      worktreePath: "/workspace",
      title: "Example",
      idempotencyKey: "task-pr:task-1:work-session-1",
      project: {
        githubOwner: "acme",
        githubRepo: "app",
        defaultBranch: "main",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/api/tasks/pull-request/ensure",
      expect.any(Object),
    );
  });
});
