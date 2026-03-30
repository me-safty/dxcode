/**
 * DroidAdapterLive - ACP (Agent Client Protocol) provider adapter.
 *
 * Spawns `droid exec --output-format acp` as a child process per session and
 * speaks JSON-RPC 2.0 over stdio. Maps ACP session/update notifications into
 * canonical ProviderRuntimeEvent vocabulary.
 *
 * @module DroidAdapterLive
 */
import {
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { DateTime, Effect, Layer, Queue, Random, Stream } from "effect";

import {
  ProviderAdapterValidationError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { DroidAdapter, type DroidAdapterShape } from "../Services/DroidAdapter.ts";
import {
  type AcpSessionState,
  createAcpRemoteSession,
  initializeAcpSession,
  sendAcpRequest,
  spawnAcpProcessSession,
  stopAcpProcessSession,
  wireAcpProcessMessages,
} from "../acpCore.ts";
import { makeAcpRuntimeBridge } from "../acpRuntimeBridge.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "droid" as const;
const DROID_PREFERRED_ENABLED_TOOLS = ["task-cli"] as const;

function getDroidAutoLevel(runtimeMode: ProviderSession["runtimeMode"]): string | undefined {
  return runtimeMode === "full-access" ? "high" : undefined;
}

function getDroidReasoningEffort(input: {
  modelSelection?: { provider: string; options?: Record<string, unknown> | undefined } | undefined;
}): string | undefined {
  if (input.modelSelection?.provider !== PROVIDER) {
    return undefined;
  }
  const effort = input.modelSelection.options?.effort;
  return typeof effort === "string" && effort.length > 0 ? effort : undefined;
}

function toParamsRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ── Layer Implementation ────────────────────────────────────────────

export const DroidAdapterLive = Layer.effect(
  DroidAdapter,
  Effect.gen(function* () {
    const sessions = new Map<string, AcpSessionState>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const serverSettingsService = yield* ServerSettingsService;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const nextTurnId = Effect.map(Random.nextUUIDv4, (id) => TurnId.makeUnsafe(id));
    const nextItemId = Effect.map(Random.nextUUIDv4, (id) => RuntimeItemId.makeUnsafe(id));
    const makeStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const offerEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

    const getSession = (
      threadId: ThreadId,
    ): Effect.Effect<AcpSessionState, ProviderAdapterError> => {
      const session = sessions.get(threadId);
      if (!session) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(session);
    };

    const acpRuntimeBridge = makeAcpRuntimeBridge({
      provider: PROVIDER,
      logLabel: "[DroidAdapter] session/update",
      makeStamp,
      nextItemId,
      offerEvent,
    });
    const {
      emitSessionStarted,
      emitTurnStarted,
      emitTurnCompleted,
      emitRuntimeError,
      emitSessionExited,
      handleSessionUpdate,
      closeOpenToolCallsForTurn,
      completeOpenStreamItemsForTurn,
      clearSessionState,
    } = acpRuntimeBridge;

    const runDetachedEffect = (
      effect: Effect.Effect<void>,
      label: string,
      metadata: Record<string, unknown>,
    ): void => {
      Effect.runPromise(effect).catch((cause) => {
        console.error(`[DroidAdapter] ${label} failed`, { ...metadata, cause });
      });
    };

    const finalizeSession = (session: AcpSessionState) =>
      Effect.gen(function* () {
        if (sessions.get(session.threadId) !== session) {
          return;
        }
        if (session.activeTurnId) {
          yield* completeOpenStreamItemsForTurn(session.threadId, session.activeTurnId);
          yield* closeOpenToolCallsForTurn(session.threadId, session.activeTurnId, "failed");
        }
        session.activeTurnId = null;
        session.status = "closed";
        yield* clearSessionState(session.threadId);
        sessions.delete(session.threadId);
        yield* emitSessionExited(session.threadId);
      });

    const settleTurnState = (
      session: AcpSessionState,
      turnId: TurnId,
      status: ProviderSession["status"],
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        if (session.activeTurnId !== turnId) {
          return;
        }
        session.activeTurnId = null;
        session.status = status;
      });

    // ── Adapter interface ───────────────────────────────────────────

    const startSession: DroidAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const settings = yield* serverSettingsService.getSettings.pipe(Effect.orDie);
        const binaryPath = settings.providers.droid.binaryPath;
        const cwd = input.cwd ?? process.cwd();
        const runtimeMode = input.runtimeMode ?? "full-access";

        const model =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
        const reasoningEffort = getDroidReasoningEffort(input);
        const autoLevel = getDroidAutoLevel(runtimeMode);
        const args = ["exec", "--output-format", "acp"];
        if (model) {
          args.push("--model", model);
        }
        if (reasoningEffort) {
          args.push("--reasoning-effort", reasoningEffort);
        }
        if (autoLevel) {
          args.push("--auto", autoLevel);
        }
        if (autoLevel === "high") {
          args.push("--enabled-tools", DROID_PREFERRED_ENABLED_TOOLS.join(","));
        }
        const session = yield* spawnAcpProcessSession({
          provider: PROVIDER,
          threadId: input.threadId,
          binaryPath,
          args,
          cwd,
          runtimeMode,
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        });

        wireAcpProcessMessages({
          session,
          onNotification: (_method, params) => handleSessionUpdate(session, toParamsRecord(params)),
          onUnhandledNotification: (method) =>
            Effect.logDebug("[DroidAdapter] unhandled notification", {
              method,
              threadId: session.threadId,
            }),
          onUnhandledMessage: (message) =>
            Effect.logDebug("[DroidAdapter] unhandled message", {
              hasMethod: "method" in message,
              hasId: "id" in message,
              threadId: session.threadId,
            }),
          onExit: () => finalizeSession(session),
        });

        yield* Effect.gen(function* () {
          yield* initializeAcpSession({
            provider: PROVIDER,
            session,
            clientName: "t3-code",
            clientVersion: "0.1.0",
          });
          yield* createAcpRemoteSession({ provider: PROVIDER, session, cwd });
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              stopAcpProcessSession(session);
              yield* clearSessionState(session.threadId);
              return yield* error;
            }),
          ),
        );

        sessions.set(input.threadId, session);
        session.status = "ready";
        yield* emitSessionStarted(input.threadId);

        return {
          provider: PROVIDER,
          status: "ready",
          runtimeMode,
          cwd,
          model: input.modelSelection?.model,
          threadId: input.threadId,
          createdAt: session.createdAt,
          updatedAt: session.createdAt,
        } satisfies ProviderSession;
      });

    const sendTurn: DroidAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const session = yield* getSession(input.threadId);
        if (session.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cannot start a new Droid turn while another turn is still running.",
          });
        }
        const turnId = yield* nextTurnId;
        session.activeTurnId = turnId;
        session.status = "running";

        yield* emitTurnStarted(
          input.threadId,
          turnId,
          session.model,
          getDroidReasoningEffort(input),
        );

        // Build prompt content blocks
        const promptBlocks: Array<{ type: string; text?: string }> = [];
        if (input.input) {
          promptBlocks.push({ type: "text", text: input.input });
        }

        // Fire session/prompt asynchronously -- the ACP response closes the turn.
        runDetachedEffect(
          Effect.gen(function* () {
            const promptStart = Date.now();
            yield* Effect.tryPromise({
              try: () =>
                sendAcpRequest(session, "session/prompt", {
                  sessionId: session.acpSessionId,
                  prompt: promptBlocks,
                }),
              catch: (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            });

            yield* Effect.logDebug("[DroidAdapter] session/prompt resolved", {
              threadId: session.threadId,
              turnId,
              elapsedSec: ((Date.now() - promptStart) / 1000).toFixed(1),
            });

            yield* completeOpenStreamItemsForTurn(session.threadId, turnId);
            yield* closeOpenToolCallsForTurn(session.threadId, turnId, "completed");

            yield* settleTurnState(session, turnId, "ready");
            yield* emitTurnCompleted(session.threadId, turnId, "completed");
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* completeOpenStreamItemsForTurn(session.threadId, turnId);
                yield* closeOpenToolCallsForTurn(session.threadId, turnId, "failed");
                yield* settleTurnState(session, turnId, "ready");
                yield* emitRuntimeError(session.threadId, turnId, error.message);
                yield* emitTurnCompleted(session.threadId, turnId, "failed", error.message);
              }),
            ),
          ),
          "session/prompt",
          { threadId: session.threadId, turnId },
        );

        return {
          threadId: input.threadId,
          turnId,
        } satisfies ProviderTurnStartResult;
      });

    const interruptTurn: DroidAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const session = yield* getSession(threadId);
        if (session.acpSessionId) {
          yield* Effect.tryPromise({
            try: () =>
              sendAcpRequest(session, "session/cancel", {
                sessionId: session.acpSessionId,
              }),
            catch: () => undefined,
          }).pipe(Effect.ignore);
        }
      });

    const respondToRequest: DroidAdapterShape["respondToRequest"] = () => Effect.void;

    const respondToUserInput: DroidAdapterShape["respondToUserInput"] = () => Effect.void;

    const stopSession: DroidAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const session = sessions.get(threadId);
        if (!session) return;
        stopAcpProcessSession(session);
        yield* finalizeSession(session);
      });

    const listSessions: DroidAdapterShape["listSessions"] = () =>
      Effect.sync(() => {
        const now = new Date().toISOString();
        return Array.from(sessions.values()).map(
          (s): ProviderSession =>
            Object.assign(
              {
                provider: PROVIDER,
                status: s.status,
                runtimeMode: s.runtimeMode,
                cwd: s.cwd,
                model: s.model,
                threadId: s.threadId,
                createdAt: s.createdAt,
                updatedAt: now,
              },
              s.activeTurnId ? { activeTurnId: s.activeTurnId } : {},
            ),
        );
      });

    const hasSession: DroidAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: DroidAdapterShape["readThread"] = (threadId) =>
      Effect.succeed({ threadId, turns: [] });

    const rollbackThread: DroidAdapterShape["rollbackThread"] = (threadId) =>
      Effect.succeed({ threadId, turns: [] });

    const stopAll: DroidAdapterShape["stopAll"] = () =>
      Effect.gen(function* () {
        for (const threadId of Array.from(sessions.keys())) {
          const session = sessions.get(threadId);
          if (!session) {
            continue;
          }
          stopAcpProcessSession(session);
          yield* finalizeSession(session);
        }
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "restart-session" },
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
        return Stream.fromQueue(runtimeEventQueue);
      },
    } satisfies DroidAdapterShape;
  }),
);
