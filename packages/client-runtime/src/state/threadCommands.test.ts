import { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  coordinateInterruptWithPendingStarts,
  threadCommandConcurrencyKey,
  ThreadTurnNotInterruptibleError,
} from "./threadCommands.ts";

describe("thread command concurrency", () => {
  const input = {
    environmentId: "environment-1",
    input: { threadId: "thread-1" },
  };

  it("keeps control commands off the mutation lane", () => {
    expect(threadCommandConcurrencyKey("control", input)).not.toBe(
      threadCommandConcurrencyKey("mutation", input),
    );
  });

  it("serializes repeated control commands for the same thread", () => {
    expect(threadCommandConcurrencyKey("control", input)).toBe(
      threadCommandConcurrencyKey("control", input),
    );
  });
});

describe("interrupt coordination with pending starts", () => {
  const registry = {} as AtomRegistry.AtomRegistry;
  const threadId = ThreadId.make("thread-1");
  const target = { environmentId: "environment-1", input: { threadId } };
  const notInterruptible = () =>
    AsyncResult.failure(Cause.fail(new ThreadTurnNotInterruptibleError({ threadId })));

  it("retries an interrupt that raced an in-flight start for the same thread", async () => {
    let releaseStart = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let startSettled = false;
    const interruptAttempts: Array<"no-active-run" | "dispatched"> = [];
    const commands = coordinateInterruptWithPendingStarts({
      startTurn: {
        label: "start-turn",
        run: async () => {
          await startGate;
          startSettled = true;
          return AsyncResult.success("started");
        },
      },
      interruptTurn: {
        label: "interrupt-turn",
        run: async () => {
          if (!startSettled) {
            interruptAttempts.push("no-active-run");
            return notInterruptible();
          }
          interruptAttempts.push("dispatched");
          return AsyncResult.success("interrupted");
        },
      },
    });

    const started = commands.startTurn.run(registry, target);
    const interrupted = commands.interruptTurn.run(registry, target);
    releaseStart();
    await started;
    const result = await interrupted;

    expect(interruptAttempts).toEqual(["no-active-run", "dispatched"]);
    expect(result._tag).toBe("Success");
  });

  it("surfaces the failure without retrying when no start is in flight", async () => {
    let interruptAttempts = 0;
    const commands = coordinateInterruptWithPendingStarts({
      startTurn: {
        label: "start-turn",
        run: async () => AsyncResult.success("started"),
      },
      interruptTurn: {
        label: "interrupt-turn",
        run: async () => {
          interruptAttempts += 1;
          return notInterruptible();
        },
      },
    });

    const result = await commands.interruptTurn.run(registry, target);

    expect(interruptAttempts).toBe(1);
    expect(result._tag).toBe("Failure");
  });

  it("ignores starts for other threads when deciding whether to retry", async () => {
    let interruptAttempts = 0;
    const commands = coordinateInterruptWithPendingStarts({
      startTurn: {
        label: "start-turn",
        run: () => new Promise<never>(() => {}),
      },
      interruptTurn: {
        label: "interrupt-turn",
        run: async () => {
          interruptAttempts += 1;
          return notInterruptible();
        },
      },
    });

    void commands.startTurn.run(registry, {
      environmentId: "environment-1",
      input: { threadId: ThreadId.make("thread-other") },
    });
    const result = await commands.interruptTurn.run(registry, target);

    expect(interruptAttempts).toBe(1);
    expect(result._tag).toBe("Failure");
  });
});
