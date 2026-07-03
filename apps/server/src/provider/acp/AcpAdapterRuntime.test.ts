import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { makeAcpThreadLock, selectPermissionOptionId } from "./AcpAdapterRuntime.ts";

describe("AcpAdapterRuntime", () => {
  it("falls back to allow_once for acceptForSession when allow_always is unavailable", () => {
    const request = {
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1" },
      options: [{ optionId: "allow-once", kind: "allow_once", name: "Allow once" }],
    } satisfies EffectAcpSchema.RequestPermissionRequest;

    expect(selectPermissionOptionId(request, "acceptForSession")).toBe("allow-once");
  });

  it.effect("allows stopped thread locks to be marked for deletion", () =>
    Effect.gen(function* () {
      const threadLock = yield* makeAcpThreadLock();
      const events: Array<string> = [];

      yield* threadLock.withThreadLock(
        "thread-1",
        Effect.gen(function* () {
          events.push("first");
          yield* threadLock.deleteThreadLock("thread-1");
        }),
      );
      yield* threadLock.withThreadLock(
        "thread-1",
        Effect.sync(() => {
          events.push("second");
        }),
      );

      expect(events).toEqual(["first", "second"]);
    }),
  );
});
