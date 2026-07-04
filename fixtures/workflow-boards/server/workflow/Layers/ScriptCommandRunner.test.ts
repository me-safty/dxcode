import { assert, it } from "@effect/vitest";
import type { TerminalAttachStreamEvent, TerminalSessionSnapshot } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { WorkflowTerminalsCapability } from "../Services/ScriptCancelRegistry.ts";
import { ScriptCommandRunner } from "../Services/ScriptCommandRunner.ts";
import { ScriptCommandRunnerLive } from "./ScriptCommandRunner.ts";

const snapshot = (input: {
  readonly threadId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly status?: TerminalSessionSnapshot["status"] | undefined;
  readonly exitCode?: number | null | undefined;
  readonly exitSignal?: number | null | undefined;
}): TerminalSessionSnapshot => ({
  threadId: input.threadId,
  terminalId: input.terminalId,
  cwd: input.cwd,
  worktreePath: null,
  status: input.status ?? "running",
  pid: 123,
  history: "",
  exitCode: input.exitCode ?? null,
  exitSignal: input.exitSignal ?? null,
  label: "script",
  updatedAt: "2026-06-07T00:00:00.000Z",
});

interface TerminalFakeInput {
  readonly calls: string[];
  readonly onSend?: (
    input: { readonly threadId: string; readonly terminalId: string; readonly data: string },
    listener: ((event: TerminalAttachStreamEvent) => Effect.Effect<void>) | null,
  ) => Effect.Effect<void>;
  readonly spawnedSnapshot?: TerminalSessionSnapshot | undefined;
}

const layerWithTerminal = (input: TerminalFakeInput) => {
  let listener: ((event: TerminalAttachStreamEvent) => Effect.Effect<void>) | null = null;
  const handle = { threadId: "script-thread", terminalId: "script-terminal" };
  return ScriptCommandRunnerLive.pipe(
    Layer.provideMerge(
      Layer.succeed(WorkflowTerminalsCapability, {
        spawn: (spawnInput) =>
          Effect.sync(() => {
            input.calls.push(
              `spawn:${spawnInput.terminalId}:${spawnInput.cwd}:${spawnInput.command}:${(
                spawnInput.args ?? []
              ).join(" ")}`,
            );
            return {
              handle,
              snapshot: input.spawnedSnapshot ?? snapshot({ ...handle, cwd: spawnInput.cwd }),
            };
          }),
        observe: (_handle, next) =>
          Effect.sync(() => {
            input.calls.push("observe");
            listener = next;
            return () => {
              input.calls.push("unsubscribe");
            };
          }),
        sendInput: (sendInput) =>
          Effect.gen(function* () {
            input.calls.push(`send:${sendInput.data}`);
            yield* input.onSend?.(sendInput, listener) ?? Effect.void;
          }),
        kill: (killInput) =>
          Effect.sync(() => {
            input.calls.push(`kill:${killInput.threadId}:${killInput.terminalId}`);
          }),
      }),
    ),
  );
};

it.effect("spawns sh -c, observes before exit input, and resolves exit events", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const layer = layerWithTerminal({
      calls,
      onSend: (input, listener) =>
        Effect.gen(function* () {
          if (listener === null) {
            assert.fail("terminal listener was not installed before sendInput");
          }
          yield* listener({
            type: "exited",
            threadId: input.threadId,
            terminalId: input.terminalId,
            exitCode: 7,
            exitSignal: 15,
          });
        }),
    });

    const result = yield* Effect.gen(function* () {
      const runner = yield* ScriptCommandRunner;
      return yield* runner.run({
        scriptThreadId: "ignored-thread" as never,
        terminalId: "script-terminal",
        cwd: "/tmp/worktree",
        run: "exit 7",
        timeout: Duration.seconds(1),
      });
    }).pipe(Effect.provide(layer));

    assert.deepEqual(result, { outcome: "exited", exitCode: 7, signal: 15 });
    assert.deepEqual(calls, [
      "spawn:script-terminal:/tmp/worktree:sh:-c exit 7",
      "observe",
      "send:exit $?\r",
      "unsubscribe",
    ]);
  }),
);

it.effect("kills the terminal and resolves timeout when no terminal event arrives", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const layer = layerWithTerminal({ calls });

    const result = yield* Effect.gen(function* () {
      const runner = yield* ScriptCommandRunner;
      const fiber = yield* Effect.forkChild(
        runner.run({
          scriptThreadId: "timeout-thread" as never,
          terminalId: "script-terminal",
          cwd: "/tmp/worktree",
          run: "sleep 10",
          timeout: Duration.millis(10),
        }),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(10));
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())));

    assert.deepEqual(result, { outcome: "timeout", exitCode: null, signal: null });
    assert.include(calls, "kill:script-thread:script-terminal");
  }),
);

it.effect("treats a closed terminal event as cooperative cancellation", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const layer = layerWithTerminal({
      calls,
      onSend: (input, listener) =>
        listener?.({
          type: "closed",
          threadId: input.threadId,
          terminalId: input.terminalId,
        }) ?? Effect.void,
    });

    const result = yield* Effect.gen(function* () {
      const runner = yield* ScriptCommandRunner;
      return yield* runner.run({
        scriptThreadId: "cancel-thread" as never,
        terminalId: "script-terminal",
        cwd: "/tmp/worktree",
        run: "sleep 10",
        timeout: Duration.seconds(1),
      });
    }).pipe(Effect.provide(layer));

    assert.deepEqual(result, { outcome: "cancelled", exitCode: null, signal: null });
  }),
);

it.effect("fails fast with the terminal error message instead of stalling on timeout", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const layer = layerWithTerminal({
      calls,
      onSend: (input, listener) =>
        listener?.({
          type: "error",
          threadId: input.threadId,
          terminalId: input.terminalId,
          message: "pty spawn failed",
        }) ?? Effect.void,
    });

    const error = yield* Effect.gen(function* () {
      const runner = yield* ScriptCommandRunner;
      return yield* runner.run({
        scriptThreadId: "error-thread" as never,
        terminalId: "script-terminal",
        cwd: "/tmp/worktree",
        run: "boom",
        timeout: Duration.minutes(10),
      });
    }).pipe(Effect.flip, Effect.provide(layer));

    assert.include(error.message, "pty spawn failed");
  }),
);

it.effect("kills the terminal when the runner fiber is interrupted", () =>
  Effect.gen(function* () {
    const sent = yield* Deferred.make<void>();
    const calls: string[] = [];
    const layer = layerWithTerminal({
      calls,
      onSend: () => Deferred.succeed(sent, undefined).pipe(Effect.asVoid),
    });

    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        const runner = yield* ScriptCommandRunner;
        return yield* runner.run({
          scriptThreadId: "interrupt-thread" as never,
          terminalId: "script-terminal",
          cwd: "/tmp/worktree",
          run: "sleep 10",
          timeout: Duration.seconds(10),
        });
      }).pipe(Effect.provide(layer)),
    );
    yield* Deferred.await(sent);
    yield* Effect.yieldNow;

    yield* Fiber.interrupt(fiber);

    assert.include(calls, "kill:script-thread:script-terminal");
  }),
);
