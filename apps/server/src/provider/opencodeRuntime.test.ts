import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFileSync: vi.fn((command: string, args: ReadonlyArray<string>) => {
    if (command === "which" && args[0] === "opencode") {
      return "/opt/homebrew/bin/opencode\n";
    }
    return "";
  }),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => childProcessMock);

describe("resolveOpenCodeBinaryPath", () => {
  it("returns absolute binary paths without PATH lookup", async () => {
    const { resolveOpenCodeBinaryPath } = await import("./opencodeRuntime.ts");

    assert.equal(resolveOpenCodeBinaryPath("/usr/local/bin/opencode"), "/usr/local/bin/opencode");
    assert.equal(childProcessMock.execFileSync.mock.calls.length, 0);
  });

  it("resolves command names through PATH", async () => {
    const { resolveOpenCodeBinaryPath } = await import("./opencodeRuntime.ts");

    assert.equal(resolveOpenCodeBinaryPath("opencode"), "/opt/homebrew/bin/opencode");
    assert.deepEqual(childProcessMock.execFileSync.mock.calls[0], [
      "which",
      ["opencode"],
      {
        encoding: "utf8",
        timeout: 3_000,
      },
    ]);
  });
});

describe("startOpenCodeServerProcess", () => {
  it("swallows close rejections when startup times out", async () => {
    vi.useFakeTimers();

    class MockStream extends EventEmitter {
      setEncoding(_encoding: string) {}
    }

    class MockChild extends EventEmitter {
      readonly stdout = new MockStream();
      readonly stderr = new MockStream();
      readonly pid = 123;
      readonly exitCode = null;
      readonly signalCode = null;

      kill(_signal?: NodeJS.Signals | number): boolean {
        queueMicrotask(() => {
          this.emit("error", new Error("shutdown failed"));
        });
        return true;
      }
    }

    const child = new MockChild();
    childProcessMock.spawn.mockReturnValueOnce(child as never);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("missing process") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });

    const unhandledRejections: Array<unknown> = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const { startOpenCodeServerProcess } = await import("./opencodeRuntime.ts");
      const startup = startOpenCodeServerProcess({
        binaryPath: "/opt/homebrew/bin/opencode",
        timeoutMs: 10,
      });
      const startupResult = startup.then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(10);
      const result = await startupResult;
      await Promise.resolve();

      assert.equal(result.ok, false);
      assert.match(
        result.error instanceof Error ? result.error.message : String(result.error),
        /Timed out waiting for OpenCode server start after 10ms\./,
      );
      assert.deepEqual(unhandledRejections, []);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      killSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
