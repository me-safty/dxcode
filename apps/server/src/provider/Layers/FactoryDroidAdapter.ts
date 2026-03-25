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
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
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

const PROVIDER = "factoryDroid" as const;
const FACTORY_API_VERSION = "1.0.0";
const FACTORY_PROTOCOL_VERSION = "1.1.0";

function droidToolNameToItemType(
  toolName: string,
): "command_execution" | "file_change" | "mcp_tool_call" | "web_search" | "dynamic_tool_call" {
  const lower = toolName.toLowerCase();
  if (
    lower.includes("execute") ||
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("command") ||
    lower === "run"
  )
    return "command_execution";
  if (
    lower.includes("write") ||
    lower.includes("create") ||
    lower.includes("edit") ||
    lower.includes("multiedit") ||
    lower.includes("patch") ||
    lower.includes("delete")
  )
    return "file_change";
  if (lower.includes("search") || lower.includes("web") || lower.includes("fetch"))
    return "web_search";
  if (lower.includes("mcp")) return "mcp_tool_call";
  return "dynamic_tool_call";
}

function droidToolTitle(toolName: string, itemType: string): string {
  if (itemType === "command_execution") return `Ran command: ${toolName}`;
  if (itemType === "file_change") return `File change: ${toolName}`;
  return toolName;
}

interface DroidSessionContext {
  session: ProviderSession;
  child: ChildProcessWithoutNullStreams | null;
  jsonRpcInitialized: boolean;
  stopped: boolean;
  turns: Array<{ id: TurnId; items: unknown[] }>;
  activeTurnId: TurnId | null;
  pendingResponses: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  pendingAssistantDelta: string;
  pendingReasoningDelta: string;
  deltaFlushTimer: ReturnType<typeof setTimeout> | null;
  pendingIdleCompletion: ReturnType<typeof setTimeout> | null;
}

export interface FactoryDroidAdapterLiveOptions {
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function readDroidProviderOptions(input: { readonly providerOptions?: unknown }): {
  readonly binaryPath?: string;
} {
  const options = input.providerOptions as
    | { factoryDroid?: { binaryPath?: string } }
    | null
    | undefined;
  return options?.factoryDroid ?? {};
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextEventId(): EventId {
  return EventId.makeUnsafe(randomUUID());
}

function makeBaseEvent(threadId: ThreadId) {
  return {
    eventId: nextEventId(),
    provider: PROVIDER,
    threadId,
    createdAt: nowIso(),
  } as const;
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
        if (context.deltaFlushTimer !== null) {
          clearTimeout(context.deltaFlushTimer);
          context.deltaFlushTimer = null;
        }
        if (context.pendingIdleCompletion !== null) {
          clearTimeout(context.pendingIdleCompletion);
          context.pendingIdleCompletion = null;
        }
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
            ...makeBaseEvent(context.session.threadId),
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
        context.pendingAssistantDelta = "";
        Effect.runPromise(
          emitRuntimeEvent({
            ...makeBaseEvent(threadId),
            type: "content.delta",
            turnId,
            payload: { streamKind: "assistant_text", delta },
          } as unknown as ProviderRuntimeEvent),
        );
      }

      if (context.pendingReasoningDelta.length > 0) {
        const delta = context.pendingReasoningDelta;
        context.pendingReasoningDelta = "";
        Effect.runPromise(
          emitRuntimeEvent({
            ...makeBaseEvent(threadId),
            type: "content.delta",
            turnId,
            payload: { streamKind: "reasoning", delta },
          } as unknown as ProviderRuntimeEvent),
        );
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
        Effect.runPromise(
          emitRuntimeEvent({
            ...makeBaseEvent(threadId),
            type: "turn.completed",
            turnId,
            payload: { state: "completed" },
          } as unknown as ProviderRuntimeEvent),
        );
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

          if (notifType === "assistant_text_delta" && turnId) {
            const delta = notif.textDelta as string;
            if (delta) {
              context.pendingAssistantDelta += delta;
              scheduleDeltaFlush(context, threadId);
            }
          } else if (notifType === "thinking_text_delta" && turnId) {
            const delta = notif.textDelta as string;
            if (delta) {
              context.pendingReasoningDelta += delta;
              scheduleDeltaFlush(context, threadId);
            }
          } else if (notifType === "droid_working_state_changed") {
            const newState = notif.newState as string;
            if (newState === "idle" && turnId) {
              scheduleIdleCompletion(context, threadId, turnId);
            }
          } else if (notifType === "create_message") {
            const msg = notif.message as Record<string, unknown> | undefined;
            if (!msg || !turnId) return;
            const role = msg.role as string;
            const content = msg.content as Array<Record<string, unknown>> | undefined;
            if (role === "assistant" && Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_use") {
                  const toolName = (block.name as string) ?? "tool";
                  const toolUseId = (block.id as string) ?? randomUUID();
                  const input = block.input as Record<string, unknown> | undefined;
                  const itemType = droidToolNameToItemType(toolName);
                  const detail =
                    itemType === "file_change"
                      ? ((input?.file_path as string) ?? (input?.path as string))
                      : itemType === "command_execution"
                        ? ((input?.command as string) ?? toolName)
                        : ((input?.file_path as string) ??
                          (input?.path as string) ??
                          (input?.pattern as string) ??
                          undefined);
                  Effect.runPromise(
                    emitRuntimeEvent({
                      ...makeBaseEvent(threadId),
                      type: "item.started",
                      turnId,
                      itemId: toolUseId,
                      payload: {
                        itemType,
                        status: "inProgress",
                        title: droidToolTitle(toolName, itemType),
                        ...(detail ? { detail } : {}),
                      },
                    } as unknown as ProviderRuntimeEvent),
                  );
                } else if (block.type === "text") {
                  const text = block.text as string;
                  if (text) {
                    context.pendingAssistantDelta += text;
                    scheduleDeltaFlush(context, threadId);
                  }
                }
              }
            }
          } else if (notifType === "tool_result") {
            if (!turnId) return;
            const toolUseId = (notif.toolUseId as string) ?? randomUUID();
            const content = notif.content as string | undefined;
            Effect.runPromise(
              emitRuntimeEvent({
                ...makeBaseEvent(threadId),
                type: "item.completed",
                turnId,
                itemId: toolUseId,
                payload: {
                  itemType: "dynamic_tool_call",
                  status: "completed",
                  title: "Tool",
                  ...(content ? { detail: content.slice(0, 200) } : {}),
                },
              } as unknown as ProviderRuntimeEvent),
            );
          } else if (notifType === "session_title_updated") {
            const title = notif.title as string | undefined;
            if (title) {
              Effect.runPromise(
                emitRuntimeEvent({
                  ...makeBaseEvent(threadId),
                  type: "thread.metadata.updated",
                  payload: { name: title },
                } as unknown as ProviderRuntimeEvent),
              );
            }
          } else if (notifType === "session_token_usage_changed") {
            const tokenUsage = notif.tokenUsage as Record<string, unknown> | undefined;
            if (tokenUsage) {
              const inputTokens = (tokenUsage.inputTokens as number) ?? 0;
              const outputTokens = (tokenUsage.outputTokens as number) ?? 0;
              const cacheReadTokens = (tokenUsage.cacheReadTokens as number) ?? 0;
              const thinkingTokens = (tokenUsage.thinkingTokens as number) ?? 0;
              const usedTokens = inputTokens + outputTokens + cacheReadTokens + thinkingTokens;
              if (usedTokens > 0) {
                Effect.runPromise(
                  emitRuntimeEvent({
                    ...makeBaseEvent(threadId),
                    type: "thread.token-usage.updated",
                    payload: {
                      usage: {
                        usedTokens,
                        ...(inputTokens > 0 ? { inputTokens } : {}),
                        ...(outputTokens > 0 ? { outputTokens } : {}),
                        ...(cacheReadTokens > 0 ? { cachedInputTokens: cacheReadTokens } : {}),
                        ...(thinkingTokens > 0 ? { reasoningOutputTokens: thinkingTokens } : {}),
                      },
                    },
                  } as unknown as ProviderRuntimeEvent),
                );
              }
            }
          } else if (notifType === "error") {
            const message = (notif.message as string) ?? "Droid runtime error";
            Effect.runPromise(
              emitRuntimeEvent({
                ...makeBaseEvent(threadId),
                type: "runtime.error",
                ...(turnId ? { turnId } : {}),
                payload: { message },
              } as unknown as ProviderRuntimeEvent),
            );
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
          Effect.runPromise(
            emitRuntimeEvent({
              ...makeBaseEvent(threadId),
              type: "runtime.error",
              turnId: context.activeTurnId,
              payload: { message: text },
            } as unknown as ProviderRuntimeEvent),
          );
        }
      });

      child.on("exit", (code) => {
        if (context.child !== child) {
          return;
        }
        if (context.deltaFlushTimer !== null) {
          clearTimeout(context.deltaFlushTimer);
          context.deltaFlushTimer = null;
        }
        if (context.pendingIdleCompletion !== null) {
          clearTimeout(context.pendingIdleCompletion);
          context.pendingIdleCompletion = null;
        }
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
          Effect.runPromise(
            emitRuntimeEvent({
              ...makeBaseEvent(threadId),
              type: "turn.completed",
              turnId,
              payload: { state: code === 0 ? "completed" : "failed" },
            } as unknown as ProviderRuntimeEvent),
          );
        }
      });
    }

    async function ensureJsonRpcProcess(context: DroidSessionContext, threadId: ThreadId) {
      if (context.jsonRpcInitialized && context.child && !context.child.killed) return;

      const droidOptions = readDroidProviderOptions(
        context.session as unknown as { providerOptions?: unknown },
      );
      const binaryPath = droidOptions.binaryPath ?? "droid";
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
          model: input.model,
          cwd: input.cwd ?? process.cwd(),
          threadId,
          createdAt: now,
          updatedAt: now,
        };

        const context: DroidSessionContext = {
          session,
          child: null,
          jsonRpcInitialized: false,
          stopped: false,
          turns: [],
          activeTurnId: null,
          pendingResponses: new Map(),
          pendingAssistantDelta: "",
          pendingReasoningDelta: "",
          deltaFlushTimer: null,
          pendingIdleCompletion: null,
        };

        sessions.set(threadId, context);

        yield* emitRuntimeEvent({
          ...makeBaseEvent(threadId),
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

        if (input.model && input.model !== context.session.model) {
          context.session = { ...context.session, model: input.model };
        }

        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: nowIso(),
        };
        context.activeTurnId = turnId;
        context.turns.push({ id: turnId, items: [] });

        yield* emitRuntimeEvent({
          ...makeBaseEvent(input.threadId),
          type: "turn.started",
          turnId,
          payload: input.model ? { model: input.model } : {},
        } as unknown as ProviderRuntimeEvent);

        yield* Effect.promise(async () => {
          await ensureJsonRpcProcess(context, input.threadId);
          await sendJsonRpc(context, "droid.add_user_message", { text: promptText });
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
