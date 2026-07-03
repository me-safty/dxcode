import { describe, expect, it, vi } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  type ProjectActionTerminalReservations,
  projectActionTerminalId,
  releaseProjectActionTerminalReservationsSeenRunning,
  resolveProjectActionTerminalId,
  runProjectScriptInTerminal,
  runningTerminalIdsWithProjectActionReservations,
  terminalOutputLooksReadyForInput,
} from "./projectScriptTerminals";

describe("project action terminal ids", () => {
  it("uses a stable action-specific terminal id", () => {
    expect(projectActionTerminalId("build")).toBe("action-build");
    expect(
      resolveProjectActionTerminalId({
        scriptId: "build",
        terminalIds: [],
        runningTerminalIds: [],
      }),
    ).toBe("action-build");
  });

  it("does not allocate a fallback id that is already reserved but not known yet", () => {
    expect(
      resolveProjectActionTerminalId({
        scriptId: "build",
        terminalIds: ["action-build"],
        runningTerminalIds: runningTerminalIdsWithProjectActionReservations({
          runningTerminalIds: ["action-build"],
          reservedTerminalIds: ["action-build:2"],
        }),
      }),
    ).toBe("action-build:3");
  });

  it("encodes script ids before adding fallback suffixes", () => {
    expect(projectActionTerminalId("build:2")).toBe("action-build%3A2");
    expect(projectActionTerminalId("build:2", 2)).toBe("action-build%3A2:2");
  });
});

describe("project action terminal reservations", () => {
  it("releases awaiting-running reservations only after running visibility or expiry", () => {
    const reservations: ProjectActionTerminalReservations = new Map([
      ["action-build", { phase: "launching", expiresAtMs: Number.POSITIVE_INFINITY }],
      ["action-test", { phase: "awaiting-running", expiresAtMs: 1_500 }],
      ["action-lint", { phase: "awaiting-running", expiresAtMs: 900 }],
    ]);

    releaseProjectActionTerminalReservationsSeenRunning({
      runningTerminalIds: ["action-test"],
      reservedTerminalIds: reservations,
      nowMs: 1_000,
    });

    expect([...reservations.keys()]).toEqual(["action-build"]);
  });
});

describe("project action terminal readiness", () => {
  it("detects common shell prompts", () => {
    expect(terminalOutputLooksReadyForInput("initializing...\n$ ")).toBe(true);
    expect(terminalOutputLooksReadyForInput("repo % ")).toBe(true);
    expect(terminalOutputLooksReadyForInput("PS C:\\repo> ")).toBe(true);
    expect(terminalOutputLooksReadyForInput("progress 100%\n")).toBe(false);
  });

  it("continues writing after advisory readiness failures", async () => {
    const openTerminal = vi.fn(async () => AsyncResult.success(undefined));
    const writeTerminal = vi.fn(async () => AsyncResult.success(undefined));
    const waitForInputReady = vi.fn(async () => AsyncResult.failure(Cause.fail("not ready")));

    const result = await runProjectScriptInTerminal({
      script: { id: "build", command: "pnpm build" },
      threadId: ThreadId.make("thread-1"),
      targetCwd: "/repo",
      targetWorktreePath: null,
      runtimeEnv: {},
      preferNewTerminal: false,
      knownTerminalIds: [],
      serverTerminalIds: [],
      visibleTerminalIds: [],
      runningTerminalIds: [],
      sessions: [],
      reservedTerminalIds: new Map(),
      isCommandInterrupted: () => false,
      showTerminal: () => undefined,
      openTerminal,
      writeTerminal,
      waitForInputReady,
      requireInputReady: waitForInputReady,
    });

    expect(result).toEqual({ _tag: "Success" });
    expect(writeTerminal).toHaveBeenCalledWith({
      threadId: ThreadId.make("thread-1"),
      terminalId: "action-build",
      data: "pnpm build\r",
    });
  });
});
