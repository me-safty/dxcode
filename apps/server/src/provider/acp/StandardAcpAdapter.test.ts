import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/schema";

import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import type { AcpSessionRuntimeShape } from "./AcpSessionRuntime.ts";
import { makeStandardAcpAdapter } from "./StandardAcpAdapter.ts";

const standardAcpAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-standard-acp-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeFakeAcpRuntime(input: {
  readonly cancelCalled: Deferred.Deferred<void>;
  readonly prompt?: () => Effect.Effect<EffectAcpSchema.PromptResponse>;
}): AcpSessionRuntimeShape {
  const ignoreHandler = () => Effect.void;
  return {
    handleRequestPermission: ignoreHandler,
    handleElicitation: ignoreHandler,
    handleReadTextFile: ignoreHandler,
    handleWriteTextFile: ignoreHandler,
    handleCreateTerminal: ignoreHandler,
    handleTerminalOutput: ignoreHandler,
    handleTerminalWaitForExit: ignoreHandler,
    handleTerminalKill: ignoreHandler,
    handleTerminalRelease: ignoreHandler,
    handleSessionUpdate: ignoreHandler,
    handleElicitationComplete: ignoreHandler,
    handleUnknownExtRequest: ignoreHandler,
    handleUnknownExtNotification: ignoreHandler,
    handleExtRequest: ignoreHandler,
    handleExtNotification: ignoreHandler,
    start: () =>
      Effect.succeed({
        sessionId: "fake-session",
        initializeResult: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
        } as EffectAcpSchema.InitializeResponse,
        sessionSetupResult: {
          sessionId: "fake-session",
        } as EffectAcpSchema.NewSessionResponse,
        modelConfigId: undefined,
      }),
    getEvents: () => Stream.empty,
    getModeState: Effect.sync(() => undefined),
    getConfigOptions: Effect.succeed([]),
    prompt: input.prompt ?? (() => Effect.succeed({ stopReason: "end_turn" })),
    cancel: Deferred.succeed(input.cancelCalled, undefined).pipe(Effect.asVoid),
    setMode: () => Effect.succeed({} as EffectAcpSchema.SetSessionModeResponse),
    setConfigOption: () => Effect.succeed({} as EffectAcpSchema.SetSessionConfigOptionResponse),
    setModel: () => Effect.void,
    request: () => Effect.succeed({}),
    notify: () => Effect.void,
  } as unknown as AcpSessionRuntimeShape;
}

it.effect("keeps interrupted ACP turns active until session/prompt resolves", () =>
  Effect.gen(function* () {
    const provider = ProviderDriverKind.make("cursor");
    const threadId = ThreadId.make("standard-acp-cancel-awaits-prompt");
    const promptStarted = yield* Deferred.make<void>();
    const promptResponse = yield* Deferred.make<EffectAcpSchema.PromptResponse>();
    const cancelCalled = yield* Deferred.make<void>();
    const runtime = makeFakeAcpRuntime({
      cancelCalled,
      prompt: () =>
        Deferred.succeed(promptStarted, undefined).pipe(
          Effect.andThen(Deferred.await(promptResponse)),
        ),
    });

    const adapter = yield* makeStandardAcpAdapter({
      provider,
      runtimeLabel: "Fake ACP",
      makeRuntime: () => Effect.succeed(runtime),
    });

    yield* adapter.startSession({
      threadId,
      provider,
      cwd: process.cwd(),
      runtimeMode: "full-access",
    });

    const sendTurnFiber = yield* adapter
      .sendTurn({
        threadId,
        input: "cancel after provider prompt resolves",
        attachments: [],
      })
      .pipe(Effect.forkChild);

    yield* Effect.yieldNow;
    assert.isUndefined(sendTurnFiber.pollUnsafe());
    yield* Deferred.await(promptStarted).pipe(Effect.timeout("1 second"));
    yield* adapter.interruptTurn(threadId).pipe(Effect.timeout("1 second"));
    yield* Deferred.await(cancelCalled).pipe(Effect.timeout("1 second"));
    yield* Effect.yieldNow;

    const earlySendTurnExit = sendTurnFiber.pollUnsafe();
    assert.isUndefined(earlySendTurnExit);

    yield* Deferred.succeed(promptResponse, { stopReason: "cancelled" });
    const result = yield* Fiber.join(sendTurnFiber);

    assert.equal(result.threadId, threadId);
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.scoped, Effect.provide(standardAcpAdapterTestLayer)),
);

it.effect("forwards session/cancel when no local active prompt is registered", () =>
  Effect.gen(function* () {
    const provider = ProviderDriverKind.make("cursor");
    const threadId = ThreadId.make("standard-acp-cancel-without-local-prompt");
    const cancelCalled = yield* Deferred.make<void>();
    const runtime = makeFakeAcpRuntime({ cancelCalled });

    const adapter = yield* makeStandardAcpAdapter({
      provider,
      runtimeLabel: "Fake ACP",
      makeRuntime: () => Effect.succeed(runtime),
    });

    yield* adapter.startSession({
      threadId,
      provider,
      cwd: process.cwd(),
      runtimeMode: "full-access",
    });

    yield* adapter.interruptTurn(threadId).pipe(Effect.timeout("1 second"));
    yield* Deferred.await(cancelCalled).pipe(Effect.timeout("1 second"));
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.scoped, Effect.provide(standardAcpAdapterTestLayer)),
);
