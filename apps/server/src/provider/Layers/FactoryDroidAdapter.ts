/**
 * FactoryDroidAdapterLive - Scoped live implementation for the Factory Droid provider adapter.
 *
 * Uses the `droid exec --output-format stream-jsonrpc --input-format stream-jsonrpc`
 * JSON-RPC protocol to achieve real token-level streaming via `assistant_text_delta`
 * notifications.
 *
 * @module FactoryDroidAdapterLive
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import readline from "node:readline";
import {
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderStartOptions,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import {
  FactoryDroidAdapter,
  type FactoryDroidAdapterShape,
} from "../Services/FactoryDroidAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  FACTORY_DROID_PROVIDER as PROVIDER,
  makeFactoryDroidBaseEvent,
  makeFactoryDroidContentDeltaEvent,
  mapFactoryDroidNotification,
} from "./FactoryDroidRuntimeEvents.ts";

const FACTORY_API_VERSION = "1.0.0";
const FACTORY_PROTOCOL_VERSION = "1.1.0";

function modelSlugFromFactorySelection(
  selection: { readonly provider: string; readonly model: string } | undefined,
): string | undefined {
  return selection?.provider === PROVIDER ? selection.model : undefined;
}

interface DroidSessionContext {
  session: ProviderSession;
  /** From `startSession` / recovery; used for custom `droid` binary path. */
  providerOptions: ProviderStartOptions | undefined;
  child: ChildProcessWithoutNullStreams | null;
  jsonRpcInitialized: boolean;
  stopped: boolean;
  turns: Array<{ id: TurnId; items: unknown[] }>;
  activeTurnId: TurnId | null;
  pendingResponses: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  pendingAssistantDelta: string;
  sawAssistantTextDelta: boolean;
  pendingReasoningDelta: string;
  assistantTextSegment: number;
  deltaFlushTimer: ReturnType<typeof setTimeout> | null;
  pendingIdleCompletion: ReturnType<typeof setTimeout> | null;
}

export interface FactoryDroidAdapterLiveOptions {
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function resolveDroidBinaryPath(providerOptions: ProviderStartOptions | undefined): string {
  const configured = providerOptions?.factoryDroid?.binaryPath?.trim();
  if (configured) return configured;
  const fromEnv = process.env.T3CODE_FACTORY_DROID_BINARY_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "droid";
}

function nowIso(): string {
  return new Date().toISOString();
}

function notifContainsToolUse(notif: Record<string, unknown>): boolean {
  const message = notif.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use",
  );
}

function clearPendingTimers(context: DroidSessionContext) {
  if (context.deltaFlushTimer !== null) {
    clearTimeout(context.deltaFlushTimer);
    context.deltaFlushTimer = null;
  }
  if (context.pendingIdleCompletion !== null) {
    clearTimeout(context.pendingIdleCompletion);
    context.pendingIdleCompletion = null;
  }
}

function resetPendingTurnBuffers(context: DroidSessionContext) {
  context.pendingAssistantDelta = "";
  context.sawAssistantTextDelta = false;
  context.pendingReasoningDelta = "";
  context.assistantTextSegment = 0;
}

function makeJsonRpcRequest(method: string, params: Record<string, unknown>, id?: string) {
  return JSON.stringify({
    factoryApiVersion: FACTORY_API_VERSION,
    factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
    type: "request",
    jsonrpc: "2.0",
    id: id ?? randomUUID(),
    method,
    params,
  });
}

const makeFactoryDroidAdapter = (options?: FactoryDroidAdapterLiveOptions) =>
  Effect.gen(function* () {
    const sessions = new Map<ThreadId, DroidSessionContext>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const emitRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(runtimeEventQueue, event).pipe(
        Effect.tap(() =>
          options?.nativeEventLogger ? options.nativeEventLogger.write(event, null) : Effect.void,
        ),
        Effect.asVoid,
      );

    const emitFromCallback = (event: ProviderRuntimeEvent) => {
      void Effect.runPromise(emitRuntimeEvent(event));
    };

    const requireSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        if (context.stopped) {
          return yield* new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId,
          });
        }
        return context;
      });

    const stopSessionInternal = (
      context: DroidSessionContext,
      opts: { emitExitEvent: boolean },
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        clearPendingTimers(context);
        if (context.child && !context.child.killed) {
          context.child.kill();
        }
        context.session = {
          ...context.session,
          status: "closed",
          activeTurnId: undefined,
          updatedAt: nowIso(),
        };
        for (const [, pending] of context.pendingResponses) {
          pending.reject(new Error("Session stopped"));
        }
        context.pendingResponses.clear();
        sessions.delete(context.session.threadId);
        if (opts.emitExitEvent) {
          yield* emitRuntimeEvent({
            ...makeFactoryDroidBaseEvent(context.session.threadId),
            type: "session.exited",
            payload: { reason: "stopped" },
          } as unknown as ProviderRuntimeEvent);
        }
      });

    function sendJsonRpc(
      context: DroidSessionContext,
      method: string,
      params: Record<string, unknown>,
    ): Promise<unknown> {
      return new Promise((resolve, reject) => {
        if (!context.child || context.child.killed || context.stopped) {
          reject(new Error("Child process not available"));
          return;
        }
        const id = randomUUID();
        context.pendingResponses.set(id, { resolve, reject });
        const msg = makeJsonRpcRequest(method, params, id);
        context.child.stdin.write(msg + "\n");
      });
    }

    const DELTA_COALESCE_MS = 50;
    const IDLE_COMPLETION_DELAY_MS = 200;

    function flushPendingDeltas(context: DroidSessionContext, threadId: ThreadId) {
      if (context.deltaFlushTimer !== null) {
        clearTimeout(context.deltaFlushTimer);
        context.deltaFlushTimer = null;
      }
      const turnId = context.activeTurnId;
      if (!turnId) return;

      if (context.pendingAssistantDelta.length > 0) {
        const delta = context.pendingAssistantDelta;
        const segmentItemId = `seg-${context.assistantTextSegment}-${turnId}`;
        context.pendingAssistantDelta = "";
        emitFromCallback(
          makeFactoryDroidContentDeltaEvent(
            threadId,
            turnId,
            "assistant_text",
            delta,
            segmentItemId,
          ),
        );
      }

      if (context.pendingReasoningDelta.length > 0) {
        const delta = context.pendingReasoningDelta;
        context.pendingReasoningDelta = "";
        emitFromCallback(makeFactoryDroidContentDeltaEvent(threadId, turnId, "reasoning", delta));
      }
    }

    function scheduleDeltaFlush(context: DroidSessionContext, threadId: ThreadId) {
      if (context.deltaFlushTimer !== null) return;
      context.deltaFlushTimer = setTimeout(() => {
        context.deltaFlushTimer = null;
        flushPendingDeltas(context, threadId);
      }, DELTA_COALESCE_MS);
    }

    function scheduleIdleCompletion(
      context: DroidSessionContext,
      threadId: ThreadId,
      turnId: TurnId,
    ) {
      if (context.pendingIdleCompletion !== null) return;
      context.pendingIdleCompletion = setTimeout(() => {
        context.pendingIdleCompletion = null;
        flushPendingDeltas(context, threadId);

        context.activeTurnId = null;
        context.session = {
          ...context.session,
          status: "ready",
          activeTurnId: undefined,
          updatedAt: nowIso(),
        };
        emitFromCallback({
          ...makeFactoryDroidBaseEvent(threadId),
          type: "turn.completed",
          turnId,
          payload: { state: "completed" },
        } as unknown as ProviderRuntimeEvent);
      }, IDLE_COMPLETION_DELAY_MS);
    }

    function setupJsonRpcListener(context: DroidSessionContext, threadId: ThreadId) {
      if (!context.child) return;

      const rl = readline.createInterface({ input: context.child.stdout });
      const child = context.child;

      rl.on("line", (line) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }

        const msgType = parsed.type as string | undefined;

        if (msgType === "response") {
          const id = parsed.id as string | null;
          if (id && context.pendingResponses.has(id)) {
            const pending = context.pendingResponses.get(id)!;
            context.pendingResponses.delete(id);
            if (parsed.error) {
              pending.reject(
                new Error((parsed.error as { message?: string }).message ?? "JSON-RPC error"),
              );
            } else {
              pending.resolve(parsed.result);
            }
          }
          return;
        }

        if (msgType === "notification") {
          const notif = (parsed.params as { notification?: Record<string, unknown> })?.notification;
          if (!notif) return;

          const notifType = notif.type as string;
          const turnId = context.activeTurnId;

          if (
            (notifType === "assistant_text_delta" || notifType === "thinking_text_delta") &&
            turnId
          ) {
            const delta = notif.textDelta as string;
            if (delta) {
              if (notifType === "assistant_text_delta") {
                context.sawAssistantTextDelta = true;
                context.pendingAssistantDelta += delta;
              } else {
                context.pendingReasoningDelta += delta;
              }
              scheduleDeltaFlush(context, threadId);
            }
          } else if (notifType === "droid_working_state_changed") {
            const newState = notif.newState as string;
            if (newState === "idle" && turnId) {
              scheduleIdleCompletion(context, threadId, turnId);
            } else if (newState !== "idle" && context.pendingIdleCompletion !== null) {
              clearTimeout(context.pendingIdleCompletion);
              context.pendingIdleCompletion = null;
            }
          } else {
            const hasToolUse = notifType === "create_message" && notifContainsToolUse(notif);

            if (hasToolUse) {
              flushPendingDeltas(context, threadId);
              context.assistantTextSegment += 1;
              context.sawAssistantTextDelta = false;
            }

            const { events, fallbackText } = mapFactoryDroidNotification({
              notif,
              sawAssistantTextDelta: context.sawAssistantTextDelta,
              threadId,
              ...(turnId ? { turnId } : {}),
            });
            for (const event of events) {
              emitFromCallback(event);
            }
            if (fallbackText) {
              context.sawAssistantTextDelta = true;
              context.pendingAssistantDelta += fallbackText;
              scheduleDeltaFlush(context, threadId);
            }
          }
          return;
        }

        if (msgType === "request") {
          const method = parsed.method as string;
          const reqId = parsed.id as string;
          if (method === "droid.request_permission" || method === "droid.ask_user") {
            const response = JSON.stringify({
              factoryApiVersion: FACTORY_API_VERSION,
              factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
              type: "response",
              jsonrpc: "2.0",
              id: reqId,
              result: { selectedOption: "always_allow" },
            });
            child?.stdin.write(response + "\n");
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text && context.activeTurnId) {
          emitFromCallback({
            ...makeFactoryDroidBaseEvent(threadId),
            type: "runtime.error",
            turnId: context.activeTurnId,
            payload: { message: text },
          } as unknown as ProviderRuntimeEvent);
        }
      });

      child.on("exit", (code) => {
        if (context.child !== child) {
          return;
        }
        clearPendingTimers(context);
        flushPendingDeltas(context, threadId);
        const turnId = context.activeTurnId;
        context.child = null;
        context.jsonRpcInitialized = false;
        context.session = {
          ...context.session,
          status: code === 0 ? "ready" : "error",
          activeTurnId: undefined,
          ...(code !== 0 ? { lastError: `droid exec exited with code ${code}` } : {}),
          updatedAt: nowIso(),
        };
        if (turnId) {
          context.activeTurnId = null;
          emitFromCallback({
            ...makeFactoryDroidBaseEvent(threadId),
            type: "turn.completed",
            turnId,
            payload: { state: code === 0 ? "completed" : "failed" },
          } as unknown as ProviderRuntimeEvent);
        }
      });
    }

    async function ensureJsonRpcProcess(context: DroidSessionContext, threadId: ThreadId) {
      if (context.jsonRpcInitialized && context.child && !context.child.killed) {
        return;
      }

      const binaryPath = resolveDroidBinaryPath(context.providerOptions);
      const autoLevel = context.session.runtimeMode === "approval-required" ? "low" : "high";

      const child = spawn(
        binaryPath,
        [
          "exec",
          "--output-format",
          "stream-jsonrpc",
          "--input-format",
          "stream-jsonrpc",
          "--auto",
          autoLevel,
        ],
        {
          cwd: context.session.cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      context.child = child;
      setupJsonRpcListener(context, threadId);

      child.once("spawn", () => {
        context.session = {
          ...context.session,
          status: "ready",
          updatedAt: nowIso(),
        };
      });

      child.once("error", (error) => {
        context.session = {
          ...context.session,
          status: "error",
          activeTurnId: undefined,
          lastError: error.message,
          updatedAt: nowIso(),
        };
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      await sendJsonRpc(context, "droid.initialize_session", {
        machineId: os.hostname(),
        sessionId: randomUUID(),
        cwd: context.session.cwd,
        modelId: context.session.model,
        autonomyLevel: autoLevel,
        interactionMode: "default",
      });

      context.jsonRpcInitialized = true;
    }

    const startSession: FactoryDroidAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const threadId = input.threadId;
        const now = nowIso();

        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          model: modelSlugFromFactorySelection(input.modelSelection),
          cwd: input.cwd ?? process.cwd(),
          threadId,
          createdAt: now,
          updatedAt: now,
        };

        const context: DroidSessionContext = {
          session,
          providerOptions: input.providerOptions,
          child: null,
          jsonRpcInitialized: false,
          stopped: false,
          turns: [],
          activeTurnId: null,
          pendingResponses: new Map(),
          pendingAssistantDelta: "",
          sawAssistantTextDelta: false,
          pendingReasoningDelta: "",
          assistantTextSegment: 0,
          deltaFlushTimer: null,
          pendingIdleCompletion: null,
        };

        sessions.set(threadId, context);

        yield* emitRuntimeEvent({
          ...makeFactoryDroidBaseEvent(threadId),
          type: "session.started",
          payload: {},
        } as unknown as ProviderRuntimeEvent);

        return { ...session };
      });

    const sendTurn: FactoryDroidAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        const turnId = TurnId.makeUnsafe(randomUUID());
        const promptText = input.input ?? "";

        const turnModel = modelSlugFromFactorySelection(input.modelSelection);
        if (turnModel && turnModel !== context.session.model) {
          context.session = { ...context.session, model: turnModel };
        }

        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: nowIso(),
        };
        context.activeTurnId = turnId;
        resetPendingTurnBuffers(context);
        context.turns.push({ id: turnId, items: [] });

        yield* emitRuntimeEvent({
          ...makeFactoryDroidBaseEvent(input.threadId),
          type: "turn.started",
          turnId,
          payload: turnModel ? { model: turnModel } : {},
        } as unknown as ProviderRuntimeEvent);

        yield* Effect.promise(async () => {
          await ensureJsonRpcProcess(context, input.threadId);
          await sendJsonRpc(context, "droid.add_user_message", {
            text: promptText,
          });
        });

        return { threadId: input.threadId, turnId };
      });

    const interruptTurn: FactoryDroidAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (context.jsonRpcInitialized && context.child && !context.child.killed) {
          yield* Effect.promise(() =>
            sendJsonRpc(context, "droid.interrupt_session", {}).catch(() => {
              context.child?.kill();
            }),
          );
        } else if (context.child && !context.child.killed) {
          context.child.kill();
        }
      });

    const readThread: FactoryDroidAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        return {
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: turn.items as ReadonlyArray<unknown>,
          })),
        };
      });

    const rollbackThread: FactoryDroidAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const nextLength = Math.max(0, context.turns.length - numTurns);
        context.turns.splice(nextLength);
        return {
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: turn.items as ReadonlyArray<unknown>,
          })),
        };
      });

    const respondToRequest: FactoryDroidAdapterShape["respondToRequest"] = (threadId, _requestId) =>
      requireSession(threadId).pipe(Effect.asVoid);

    const respondToUserInput: FactoryDroidAdapterShape["respondToUserInput"] = (
      threadId,
      _requestId,
    ) => requireSession(threadId).pipe(Effect.asVoid);

    const stopSession: FactoryDroidAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* stopSessionInternal(context, { emitExitEvent: true });
      });

    const listSessions: FactoryDroidAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));

    const hasSession: FactoryDroidAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const stopAll: FactoryDroidAdapterShape["stopAll"] = () =>
      Effect.forEach(
        sessions,
        ([, context]) => stopSessionInternal(context, { emitExitEvent: true }),
        { discard: true },
      );

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        sessions,
        ([, context]) => stopSessionInternal(context, { emitExitEvent: false }),
        { discard: true },
      ).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        statelessRecovery: true,
        requiresStreamingDelivery: true,
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies FactoryDroidAdapterShape;
  });

export const FactoryDroidAdapterLive = Layer.effect(FactoryDroidAdapter, makeFactoryDroidAdapter());

export function makeFactoryDroidAdapterLive(options?: FactoryDroidAdapterLiveOptions) {
  return Layer.effect(FactoryDroidAdapter, makeFactoryDroidAdapter(options));
}
