import * as NodeAssert from "node:assert/strict";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  KiloSettings,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { beforeEach } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { KiloRuntime, KiloRuntimeError, type KiloRuntimeShape } from "../kiloRuntime.ts";
import type { KiloAdapterShape } from "../Services/KiloAdapter.ts";
import { makeKiloAdapter } from "./KiloAdapter.ts";

class KiloAdapter extends Context.Service<KiloAdapter, KiloAdapterShape>()(
  "t3/provider/Layers/KiloAdapter.test/KiloAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const runtimeMock = {
  state: {
    startCalls: [] as string[],
    sessionCreates: 0,
    promptCalls: [] as Array<unknown>,
    abortCalls: [] as string[],
    subscribedEvents: [] as unknown[],
  },
  reset() {
    this.state.startCalls.length = 0;
    this.state.sessionCreates = 0;
    this.state.promptCalls.length = 0;
    this.state.abortCalls.length = 0;
    this.state.subscribedEvents.length = 0;
  },
};

const KiloRuntimeTestDouble: KiloRuntimeShape = {
  startServer: ({ binaryPath }) =>
    Effect.gen(function* () {
      runtimeMock.state.startCalls.push(binaryPath);
      return {
        url: "http://127.0.0.1:4301",
        external: false as const,
        exitCode: Effect.never,
      };
    }),
  runCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createClient: () =>
    ({
      session: {
        create: async () => {
          runtimeMock.state.sessionCreates += 1;
          return { data: { id: "kilo-session-1" } };
        },
        abort: async ({ sessionID }: { sessionID: string }) => {
          runtimeMock.state.abortCalls.push(sessionID);
        },
        promptAsync: async (input: unknown) => {
          runtimeMock.state.promptCalls.push(input);
        },
        messages: async () => ({ data: [] }),
        revert: async () => {},
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            for (const event of runtimeMock.state.subscribedEvents) {
              yield event;
            }
          })(),
        }),
      },
      permission: {
        reply: async () => {},
      },
      question: {
        reply: async () => {},
      },
    }) as unknown as ReturnType<KiloRuntimeShape["createClient"]>,
  loadInventory: () =>
    Effect.fail(
      new KiloRuntimeError({
        operation: "loadInventory",
        detail: "KiloRuntimeTestDouble.loadInventory not used in this test",
        cause: null,
      }),
    ),
};

const kiloAdapterTestSettings = Schema.decodeSync(KiloSettings)({
  binaryPath: "fake-kilo",
});

const KiloAdapterTestLayer = Layer.effect(
  KiloAdapter,
  makeKiloAdapter(kiloAdapterTestSettings),
).pipe(
  Layer.provideMerge(Layer.succeed(KiloRuntime, KiloRuntimeTestDouble)),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

beforeEach(() => {
  runtimeMock.reset();
});

const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

const collectThreadEvents = (adapter: KiloAdapterShape, threadId: ThreadId) =>
  Effect.gen(function* () {
    const collected: Array<ProviderRuntimeEvent> = [];
    const drain = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          collected.push(event);
        }),
      ),
      Effect.forkChild,
    );
    return { collected, drain };
  });

const stopDrain = (drain: Fiber.Fiber<void, never>) => Fiber.interrupt(drain);

it.layer(KiloAdapterTestLayer)("KiloAdapterLive", (it) => {
  it.effect(
    "suppresses Kilo SDK synthetic snapshot-progress parts from the runtime event stream",
    () =>
      Effect.gen(function* () {
        const adapter = yield* KiloAdapter;
        const threadId = asThreadId("thread-kilo-snapshot-progress");
        const assistantMessageId = "msg-kilo-snapshot-progress";
        const snapshotPartId = "part-kilo-snapshot-progress";

        runtimeMock.state.subscribedEvents = [
          {
            type: "message.updated",
            properties: {
              sessionID: "kilo-session-1",
              info: { id: assistantMessageId, role: "assistant" },
            },
          },
          {
            type: "message.part.updated",
            properties: {
              sessionID: "kilo-session-1",
              time: 1,
              part: {
                id: snapshotPartId,
                sessionID: "kilo-session-1",
                messageID: assistantMessageId,
                type: "text",
                text: "⠋ Initializing snapshot…",
              },
            },
          },
          {
            type: "message.part.updated",
            properties: {
              sessionID: "kilo-session-1",
              time: 2,
              part: {
                id: snapshotPartId,
                sessionID: "kilo-session-1",
                messageID: assistantMessageId,
                type: "text",
                text: "⠙ Initializing snapshot…",
              },
            },
          },
        ];

        const { collected, drain } = yield* collectThreadEvents(adapter, threadId);

        yield* adapter.startSession({
          provider: ProviderDriverKind.make("kilo"),
          threadId,
          runtimeMode: "full-access",
        });

        yield* advanceTestClock(50);

        const assistantTextDeltas = collected.filter(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "assistant_text",
        ) as Array<Extract<ProviderRuntimeEvent, { type: "content.delta" }>>;

        NodeAssert.deepEqual(
          assistantTextDeltas.map((event) => event.payload.delta),
          [],
          "snapshot-progress text must not produce assistant_text content deltas",
        );

        NodeAssert.equal(
          collected.some(
            (event) =>
              event.type === "item.completed" &&
              event.payload.itemType === "assistant_message" &&
              typeof event.payload.detail === "string" &&
              event.payload.detail.includes("Initializing snapshot"),
          ),
          false,
          "snapshot-progress text must not produce assistant_message item.completed events",
        );

        yield* stopDrain(drain);
      }),
  );

  it.effect("still surfaces real assistant text from the same assistant message", () =>
    Effect.gen(function* () {
      const adapter = yield* KiloAdapter;
      const threadId = asThreadId("thread-kilo-real-text");
      const assistantMessageId = "msg-kilo-real-text";
      const realPartId = "part-kilo-real-text";

      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "kilo-session-1",
            info: { id: assistantMessageId, role: "assistant" },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "kilo-session-1",
            time: 1,
            part: {
              id: realPartId,
              sessionID: "kilo-session-1",
              messageID: assistantMessageId,
              type: "text",
              text: "Hello there",
            },
          },
        },
      ];

      const { collected, drain } = yield* collectThreadEvents(adapter, threadId);

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("kilo"),
        threadId,
        runtimeMode: "full-access",
      });

      yield* advanceTestClock(50);

      const assistantTextDeltas = collected.filter(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      ) as Array<Extract<ProviderRuntimeEvent, { type: "content.delta" }>>;

      NodeAssert.deepEqual(
        assistantTextDeltas.map((event) => event.payload.delta),
        ["Hello there"],
      );

      yield* stopDrain(drain);
    }),
  );

  it.effect("clears local per-part bookkeeping when the SDK removes a part", () =>
    Effect.gen(function* () {
      const adapter = yield* KiloAdapter;
      const threadId = asThreadId("thread-kilo-part-removed");
      const assistantMessageId = "msg-kilo-part-removed";
      const partId = "part-kilo-part-removed";

      runtimeMock.state.subscribedEvents = [
        {
          type: "message.updated",
          properties: {
            sessionID: "kilo-session-1",
            info: { id: assistantMessageId, role: "assistant" },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "kilo-session-1",
            time: 1,
            part: {
              id: partId,
              sessionID: "kilo-session-1",
              messageID: assistantMessageId,
              type: "text",
              text: "Hi",
              time: { start: 1, end: 2 },
            },
          },
        },
        {
          type: "message.part.removed",
          properties: {
            sessionID: "kilo-session-1",
            messageID: assistantMessageId,
            partID: partId,
          },
        },
      ];

      const { collected, drain } = yield* collectThreadEvents(adapter, threadId);

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("kilo"),
        threadId,
        runtimeMode: "full-access",
      });

      yield* advanceTestClock(50);

      // Removal should be a quiet, local-only cleanup: the pre-removal text
      // update still produces its normal completion event, but no extra
      // runtime event is emitted for the removal itself.
      NodeAssert.equal(
        collected.some(
          (event) =>
            event.type === "item.completed" &&
            event.payload.itemType === "assistant_message" &&
            event.payload.detail === "Hi",
        ),
        true,
        "the pre-removal text update must still produce an assistant_message item.completed",
      );
      NodeAssert.deepEqual(
        collected.map((event) => event.type),
        ["session.started", "thread.started", "content.delta", "item.completed"],
        "the removal must not produce any extra runtime events",
      );

      yield* stopDrain(drain);
    }),
  );

  it.effect(
    "backfills assistant text when message.part.updated arrives before message.updated",
    () =>
      Effect.gen(function* () {
        const adapter = yield* KiloAdapter;
        const threadId = asThreadId("thread-kilo-backfill");
        const assistantMessageId = "msg-kilo-backfill";
        const backfillPartId = "part-kilo-backfill";

        runtimeMock.state.subscribedEvents = [
          {
            // The part update arrives first, before the SDK has told us the
            // role of the message it belongs to.
            type: "message.part.updated",
            properties: {
              sessionID: "kilo-session-1",
              time: 1,
              part: {
                id: backfillPartId,
                sessionID: "kilo-session-1",
                messageID: assistantMessageId,
                type: "text",
                text: "Hello there",
                time: { start: 1, end: 2 },
              },
            },
          },
          {
            type: "message.updated",
            properties: {
              sessionID: "kilo-session-1",
              info: { id: assistantMessageId, role: "assistant" },
            },
          },
        ];

        const { collected, drain } = yield* collectThreadEvents(adapter, threadId);

        yield* adapter.startSession({
          provider: ProviderDriverKind.make("kilo"),
          threadId,
          runtimeMode: "full-access",
        });

        yield* advanceTestClock(50);

        const assistantTextDeltas = collected.filter(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "assistant_text",
        ) as Array<Extract<ProviderRuntimeEvent, { type: "content.delta" }>>;

        NodeAssert.deepEqual(
          assistantTextDeltas.map((event) => event.payload.delta),
          ["Hello there"],
          "the assistant text part must be surfaced once via backfill even when the role was unknown at update time",
        );

        const completed = collected.find(
          (event) =>
            event.type === "item.completed" && event.payload.itemType === "assistant_message",
        );
        NodeAssert.equal(completed?.type, "item.completed");
        if (completed?.type === "item.completed") {
          NodeAssert.equal(completed.payload.detail, "Hello there");
        }

        yield* stopDrain(drain);
      }),
  );
});
