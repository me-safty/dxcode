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
    vi.stubEnv("T3_EXECUTION_BRIDGE_BASE_URL", "https://t3.example.com/");
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
      "https://t3.example.com/api/execution/runs/continue",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer shared-secret" }),
      }),
    );
  });

  it("summarizes HTML bridge failures without including the response body", async () => {
    vi.stubEnv("T3_EXECUTION_BRIDGE_BASE_URL", "https://t3.example.com");
    vi.stubEnv("T3_EXECUTION_BRIDGE_SHARED_SECRET", "shared-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html><body>cloudflare bad gateway</body></html>", {
            status: 502,
            statusText: "Bad Gateway",
            headers: {
              "content-type": "text/html",
            },
          }),
      ),
    );

    const client = createT3ExecutionBridgeClient();
    await expect(
      client.continueExecutionRun({
        controlThreadId: "task-1",
        executionRunId: "run-1",
        t3ThreadId: decodeThreadId("thread-1"),
        prompt: "continue",
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    ).rejects.toThrow("T3 execution bridge rejected run continue (502): HTTP 502 Bad Gateway");
  });
});
