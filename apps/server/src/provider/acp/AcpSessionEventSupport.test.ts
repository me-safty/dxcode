import { ProviderDriverKind, type ProviderRuntimeEvent, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  emitDedupedAcpPlanUpdate,
  fingerprintAcpPlanUpdate,
  mapAcpParsedSessionEvent,
} from "./AcpSessionEventSupport.ts";

describe("AcpSessionEventSupport", () => {
  it("fingerprints plan updates by turn and payload", () => {
    const fingerprint = fingerprintAcpPlanUpdate({
      activeTurnId: TurnId.make("turn-1"),
      payload: { plan: [{ step: "Inspect", status: "completed" }] },
      encodePayload: (payload) => JSON.stringify(payload),
    });
    expect(fingerprint).toContain("turn-1");
  });

  it("deduplicates repeated plan updates", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: Array<string> = [];
        const planState = { lastPlanFingerprint: undefined };
        const context = {
          threadId: "thread-1" as never,
          activeTurnId: TurnId.make("turn-1"),
        };
        const payload = { plan: [{ step: "Inspect", status: "completed" as const }] };
        const input = {
          provider: ProviderDriverKind.make("grok-build"),
          context,
          stamp: { eventId: "event-1" as never, createdAt: "2026-06-18T00:00:00.000Z" },
          planState,
          payload,
          rawPayload: payload,
          source: "acp.jsonrpc" as const,
          method: "session/update",
          encodePlanPayload: (value: unknown) => JSON.stringify(value),
          offerRuntimeEvent: (event: ProviderRuntimeEvent) =>
            Effect.sync(() => {
              events.push(event.type);
            }),
        };

        yield* emitDedupedAcpPlanUpdate(input);
        yield* emitDedupedAcpPlanUpdate(input);

        expect(events).toEqual(["turn.plan.updated"]);
      }),
    ));

  it("invokes onModeChanged when provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const modes: Array<string> = [];
        yield* mapAcpParsedSessionEvent({
          event: {
            _tag: "ModeChanged",
            modeId: "plan",
          },
          provider: ProviderDriverKind.make("grok-build"),
          context: {
            threadId: "thread-1" as never,
            activeTurnId: TurnId.make("turn-1"),
          },
          stamp: { eventId: "event-1" as never, createdAt: "2026-06-18T00:00:00.000Z" },
          offerRuntimeEvent: () => Effect.void,
          onModeChanged: ({ modeId }) =>
            Effect.sync(() => {
              modes.push(modeId);
            }),
        });

        expect(modes).toEqual(["plan"]);
      }),
    ));

  it("ignores mode changes when no handler is provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let eventCount = 0;
        yield* mapAcpParsedSessionEvent({
          event: {
            _tag: "ModeChanged",
            modeId: "plan",
          },
          provider: ProviderDriverKind.make("cursor"),
          context: {
            threadId: "thread-1" as never,
            activeTurnId: TurnId.make("turn-1"),
          },
          stamp: { eventId: "event-1" as never, createdAt: "2026-06-18T00:00:00.000Z" },
          offerRuntimeEvent: () =>
            Effect.sync(() => {
              eventCount += 1;
            }),
        });
        expect(eventCount).toBe(0);
      }),
    ));

  it("maps assistant content deltas to runtime events", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: Array<string> = [];
        yield* mapAcpParsedSessionEvent({
          event: {
            _tag: "ContentDelta",
            text: "hello",
            rawPayload: { text: "hello" },
          },
          provider: ProviderDriverKind.make("cursor"),
          context: {
            threadId: "thread-1" as never,
            activeTurnId: TurnId.make("turn-1"),
          },
          stamp: { eventId: "event-1" as never, createdAt: "2026-06-18T00:00:00.000Z" },
          offerRuntimeEvent: (event: ProviderRuntimeEvent) =>
            Effect.sync(() => {
              events.push(event.type);
            }),
        });

        expect(events).toEqual(["content.delta"]);
      }),
    ));
});
