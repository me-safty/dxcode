import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeFakeSandboxProvider } from "./FakeSandboxProvider.ts";

const materializeInput = {
  taskId: "task-1",
  workSessionId: "work-session-1",
  title: "Fix login",
  initialPrompt: "Investigate the login failure",
  project: {
    repoName: "t3code",
    workspaceRoot: "/repo/t3code",
    defaultBranch: "main",
  },
  services: [
    {
      kind: "t3-runtime",
      required: true,
    },
  ],
  idempotencyKey: "sandbox:local:task-1:work-session-1",
  startCodingAgent: true,
} as const;

describe("FakeSandboxProvider", () => {
  it("materializes deterministic fake Sandboxes", async () => {
    const provider = makeFakeSandboxProvider({
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await Effect.runPromise(provider.materializeTaskRuntime(materializeInput));

    expect(result.sandbox.providerKind).toBe("local");
    expect(result.sandbox.status).toBe("ready");
    expect(result.sandbox.worktree?.branch).toBe("task/fix-login-task-1");
    expect(result.services[0]?.status).toBe("ready");
  });

  it("reuses Sandboxes for the same idempotency key", async () => {
    const provider = makeFakeSandboxProvider();
    const first = await Effect.runPromise(provider.materializeTaskRuntime(materializeInput));
    const second = await Effect.runPromise(provider.materializeTaskRuntime(materializeInput));

    expect(second.sandbox.sandboxId).toBe(first.sandbox.sandboxId);
  });

  it("archives and terminates existing Sandboxes", async () => {
    const provider = makeFakeSandboxProvider({
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const result = await Effect.runPromise(provider.materializeTaskRuntime(materializeInput));
    const archived = await Effect.runPromise(
      provider.archive({ sandboxId: result.sandbox.sandboxId }),
    );
    const terminated = await Effect.runPromise(
      provider.terminate({ sandboxId: result.sandbox.sandboxId }),
    );

    expect(archived.sandbox.status).toBe("archived");
    expect(terminated.sandboxId).toBe(result.sandbox.sandboxId);
    await expect(
      Effect.runPromise(provider.getStatus({ sandboxId: result.sandbox.sandboxId })),
    ).resolves.toMatchObject({ status: "terminated" });
  });

  it("returns stable errors when configured to fail", async () => {
    const provider = makeFakeSandboxProvider({ failMaterialize: true });
    const exit = await Effect.runPromiseExit(provider.materializeTaskRuntime(materializeInput));

    expect(exit._tag).toBe("Failure");
  });
});
