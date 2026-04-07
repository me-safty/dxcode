import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import { GlmAdapter, type GlmAdapterShape } from "../Services/GlmAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import type {
  ProviderAdapterCapabilities,
  ProviderThreadSnapshot,
} from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = "glm" as const;

export interface GlmAdapterLiveOptions {
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function remapSessionProvider(session: ProviderSession): ProviderSession {
  return { ...session, provider: PROVIDER };
}

function makeGlmAdapter(options?: GlmAdapterLiveOptions) {
  return Effect.gen(function* () {
    const codexAdapter = yield* CodexAdapter;
    const glmEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const glmThreadIds = new Set<ThreadId>();
    const _nativeEventLogger = options?.nativeEventLogger;

    const capabilities: ProviderAdapterCapabilities = {
      sessionModelSwitch: "restart-session",
    };

    const startSession = (
      input: ProviderSessionStartInput,
    ): Effect.Effect<ProviderSession, ProviderAdapterError> =>
      Effect.gen(function* () {
        glmThreadIds.add(input.threadId);
        const session = yield* codexAdapter.startSession({
          ...input,
          provider: "codex",
        });
        return remapSessionProvider(session);
      });

    const sendTurn = (
      input: ProviderSendTurnInput,
    ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> => codexAdapter.sendTurn(input);

    const interruptTurn = (
      threadId: ThreadId,
      turnId?: TurnId,
    ): Effect.Effect<void, ProviderAdapterError> => codexAdapter.interruptTurn(threadId, turnId);

    const respondToRequest = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      decision: ProviderApprovalDecision,
    ): Effect.Effect<void, ProviderAdapterError> =>
      codexAdapter.respondToRequest(threadId, requestId, decision);

    const respondToUserInput = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      answers: ProviderUserInputAnswers,
    ): Effect.Effect<void, ProviderAdapterError> =>
      codexAdapter.respondToUserInput(threadId, requestId, answers);

    const stopSession = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* codexAdapter.stopSession(threadId);
        glmThreadIds.delete(threadId);
      });

    const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      codexAdapter
        .listSessions()
        .pipe(
          Effect.map((sessions) =>
            sessions.filter((s) => glmThreadIds.has(s.threadId)).map(remapSessionProvider),
          ),
        );

    const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
      glmThreadIds.has(threadId) ? codexAdapter.hasSession(threadId) : Effect.succeed(false);

    const readThread = (
      threadId: ThreadId,
    ): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
      codexAdapter.readThread(threadId);

    const rollbackThread = (
      threadId: ThreadId,
      numTurns: number,
    ): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
      codexAdapter.rollbackThread(threadId, numTurns);

    const stopAll = (): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        for (const threadId of glmThreadIds) {
          yield* codexAdapter.stopSession(threadId).pipe(Effect.ignore);
        }
        glmThreadIds.clear();
      });

    return {
      provider: PROVIDER,
      capabilities,
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(glmEventQueue);
      },
    } satisfies GlmAdapterShape;
  });
}

export function makeGlmAdapterLive(options?: GlmAdapterLiveOptions) {
  return Layer.effect(GlmAdapter, makeGlmAdapter(options));
}
