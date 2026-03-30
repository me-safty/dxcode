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
  type CanonicalItemType,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  EventId,
  RuntimeItemId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { DateTime, Effect, Layer, Queue, Random, Stream } from "effect";
import * as ChildProcess from "node:child_process";
import * as readline from "node:readline";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { DroidAdapter, type DroidAdapterShape } from "../Services/DroidAdapter.ts";
import { classifyToolItemType, summarizeToolRequest, titleForTool } from "../toolCallMetadata.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "droid" as const;
const ACP_VERSION = 1;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferAcpToolName(title: unknown, rawInput: unknown): string {
  const input = asRecord(rawInput);
  const candidates = [
    title,
    input?.toolName,
    input?.tool_name,
    input?.name,
    input?.tool,
    input?.type,
  ];

  for (const candidate of candidates) {
    const value = asTrimmedString(candidate);
    if (value) {
      return value;
    }
  }

  if (asTrimmedString(input?.subagent_type)) {
    return "Task";
  }

  return "Tool";
}

function summarizeAcpToolInput(toolName: string, rawInput: unknown): string | undefined {
  const input = asRecord(rawInput);
  if (input) {
    return summarizeToolRequest(toolName, input);
  }

  if (rawInput === undefined) {
    return undefined;
  }

  const serialized = JSON.stringify(rawInput);
  if (!serialized || serialized === "{}") {
    return undefined;
  }
  if (serialized.length <= 400) {
    return `${toolName}: ${serialized}`;
  }
  return `${toolName}: ${serialized.slice(0, 397)}...`;
}

function taskDescriptionFromToolInput(
  toolName: string,
  rawInput: unknown,
  detail?: string,
): string {
  const input = asRecord(rawInput);
  const description =
    asTrimmedString(input?.description) ??
    asTrimmedString(input?.prompt) ??
    asTrimmedString(input?.instructions) ??
    detail ??
    `${titleForTool(classifyToolItemType(toolName, input))} in progress`;
  return description;
}

function collectAcpToolOutputDeltas(
  rawOutput: unknown,
  content: ReadonlyArray<unknown> | undefined,
): string[] {
  const deltas: string[] = [];

  const rawOutputText = asTrimmedString(asRecord(rawOutput)?.text);
  if (rawOutputText) {
    deltas.push(rawOutputText);
  }

  for (const chunk of content ?? []) {
    const chunkRecord = asRecord(chunk);
    if (!chunkRecord) {
      continue;
    }
    const directText = asTrimmedString(chunkRecord.text);
    if (directText) {
      deltas.push(directText);
      continue;
    }
    const nestedText = asTrimmedString(asRecord(chunkRecord.content)?.text);
    if (nestedText) {
      deltas.push(nestedText);
    }
  }

  return deltas;
}

function toolCallKey(threadId: ThreadId, toolCallId: string): string {
  return `${threadId}:tc:${toolCallId}`;
}

function toolCallData(toolName: string, input: unknown): { toolName: string; input?: unknown } {
  return {
    toolName,
    ...(input !== undefined ? { input } : {}),
  };
}

interface AcpToolCallState {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly itemId: RuntimeItemId;
  readonly taskId: RuntimeTaskId | null;
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly taskDescription: string;
  detail?: string;
  lastTaskSummary?: string;
}

// ── JSON-RPC helpers ────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

// ── ACP Session State ───────────────────────────────────────────────

interface AcpSessionState {
  readonly threadId: ThreadId;
  readonly process: ChildProcess.ChildProcess;
  readonly rl: readline.Interface;
  readonly pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  nextId: number;
  acpSessionId: string | null;
  activeTurnId: TurnId | null;
  status: ProviderSession["status"];
  cwd: string | undefined;
  model: string | undefined;
  createdAt: string;
}

function sendMessage(session: AcpSessionState, msg: JsonRpcRequest | JsonRpcNotification): void {
  const data = JSON.stringify(msg);
  session.process.stdin?.write(data + "\n");
}

function sendRequest(session: AcpSessionState, method: string, params?: unknown): Promise<unknown> {
  const id = session.nextId++;
  return new Promise((resolve, reject) => {
    session.pendingRequests.set(id, { resolve, reject });
    sendMessage(session, { jsonrpc: "2.0", id, method, params });
  });
}

function sendNotification(session: AcpSessionState, method: string, params?: unknown): void {
  sendMessage(session, { jsonrpc: "2.0", method, params });
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

    const runtimeEvent = (obj: Record<string, unknown>): ProviderRuntimeEvent =>
      obj as unknown as ProviderRuntimeEvent;

    const emitSessionStarted = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "session.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: {},
          }),
        );
      });

    const emitTurnStarted = (threadId: ThreadId, turnId: TurnId, model?: string, effort?: string) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "turn.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
            },
          }),
        );
      });

    const emitTurnCompleted = (
      threadId: ThreadId,
      turnId: TurnId,
      state: "completed" | "failed",
      errorMessage?: string,
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "turn.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              state,
              ...(errorMessage ? { errorMessage } : {}),
            },
          }),
        );
      });

    const emitContentDelta = (
      threadId: ThreadId,
      turnId: TurnId,
      itemId: RuntimeItemId,
      text: string,
      streamKind: string,
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "content.delta",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            itemId,
            createdAt: stamp.createdAt,
            payload: {
              streamKind,
              delta: text,
            },
          }),
        );
      });

    const emitItemStarted = (
      threadId: ThreadId,
      turnId: TurnId,
      itemId: RuntimeItemId,
      itemType: string,
      metadata?: {
        title?: string;
        detail?: string;
        data?: unknown;
      },
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "item.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            itemId,
            createdAt: stamp.createdAt,
            payload: {
              itemType,
              status: "inProgress",
              ...(metadata?.title ? { title: metadata.title } : {}),
              ...(metadata?.detail ? { detail: metadata.detail } : {}),
              ...(metadata?.data !== undefined ? { data: metadata.data } : {}),
            },
          }),
        );
      });

    const emitItemUpdated = (
      threadId: ThreadId,
      turnId: TurnId,
      itemId: RuntimeItemId,
      itemType: string,
      metadata?: {
        title?: string;
        detail?: string;
        data?: unknown;
      },
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "item.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            itemId,
            createdAt: stamp.createdAt,
            payload: {
              itemType,
              status: "inProgress",
              ...(metadata?.title ? { title: metadata.title } : {}),
              ...(metadata?.detail ? { detail: metadata.detail } : {}),
              ...(metadata?.data !== undefined ? { data: metadata.data } : {}),
            },
          }),
        );
      });

    const emitItemCompleted = (
      threadId: ThreadId,
      turnId: TurnId,
      itemId: RuntimeItemId,
      itemType: string,
      status: "completed" | "failed",
      metadata?: {
        title?: string;
        detail?: string;
        data?: unknown;
      },
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "item.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            itemId,
            createdAt: stamp.createdAt,
            payload: {
              itemType,
              status,
              ...(metadata?.title ? { title: metadata.title } : {}),
              ...(metadata?.detail ? { detail: metadata.detail } : {}),
              ...(metadata?.data !== undefined ? { data: metadata.data } : {}),
            },
          }),
        );
      });

    const emitTaskStarted = (
      threadId: ThreadId,
      turnId: TurnId,
      taskId: RuntimeTaskId,
      description: string,
      taskType?: string,
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "task.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              taskId,
              description,
              ...(taskType ? { taskType } : {}),
            },
          }),
        );
      });

    const emitTaskProgress = (
      threadId: ThreadId,
      turnId: TurnId,
      taskId: RuntimeTaskId,
      description: string,
      summary: string,
      lastToolName?: string,
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "task.progress",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              taskId,
              description,
              summary,
              ...(lastToolName ? { lastToolName } : {}),
            },
          }),
        );
      });

    const emitTaskCompleted = (
      threadId: ThreadId,
      turnId: TurnId,
      taskId: RuntimeTaskId,
      status: "completed" | "failed",
      summary?: string,
    ) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "task.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              taskId,
              status,
              ...(summary ? { summary } : {}),
            },
          }),
        );
      });

    const emitSessionExited = (threadId: ThreadId, reason?: string) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "session.exited",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: {
              ...(reason ? { reason } : {}),
              exitKind: "graceful",
            },
          }),
        );
      });

    const emitRuntimeError = (threadId: ThreadId, turnId: TurnId | undefined, message: string) =>
      Effect.gen(function* () {
        const stamp = yield* makeStamp();
        yield* offerEvent(
          runtimeEvent({
            type: "runtime.error",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              class: "provider_error",
              message,
            },
          }),
        );
      });

    // ── ACP session/update notification handler ─────────────────────

    const runtimeItemIds = new Map<string, RuntimeItemId>();
    const toolCalls = new Map<string, AcpToolCallState>();

    const emitToolCallCompletion = (
      state: AcpToolCallState,
      status: "completed" | "failed",
      summary?: string,
    ) =>
      Effect.gen(function* () {
        const detail = summary ?? state.detail;
        yield* emitItemCompleted(
          state.threadId,
          state.turnId,
          state.itemId,
          state.itemType,
          status,
          {
            title: state.title,
            ...(detail ? { detail } : {}),
            data: toolCallData(state.toolName, state.input),
          },
        );
        if (state.taskId) {
          yield* emitTaskCompleted(
            state.threadId,
            state.turnId,
            state.taskId,
            status,
            summary ?? state.lastTaskSummary,
          );
        }
        toolCalls.delete(state.key);
      });

    const closeOpenToolCallsForTurn = (
      threadId: ThreadId,
      turnId: TurnId,
      status: "completed" | "failed",
    ) =>
      Effect.forEach(
        Array.from(toolCalls.values()).filter(
          (state) => state.threadId === threadId && state.turnId === turnId,
        ),
        (state) => emitToolCallCompletion(state, status),
        { discard: true },
      );

    const handleSessionUpdate = (session: AcpSessionState, params: Record<string, unknown>) =>
      Effect.gen(function* () {
        const threadId = session.threadId;
        const turnId = session.activeTurnId;
        if (!turnId) return;

        const update = asRecord(params.update);
        if (!update) return;

        const kind = asTrimmedString(update.sessionUpdate);

        yield* Effect.logDebug("[DroidAdapter] session/update", {
          kind,
          threadId,
          turnId,
          ts: new Date().toISOString(),
          ...(kind === "tool_call" || kind === "tool_call_update"
            ? {
                toolCallId: update.toolCallId ?? "",
                status: update.status ?? "",
                title: update.title ?? "",
              }
            : {}),
          ...(kind === "agent_message_chunk"
            ? {
                contentType: asRecord(update.content)?.type,
                textLen: asTrimmedString(asRecord(update.content)?.text)?.length ?? 0,
              }
            : {}),
        });

        if (kind === "agent_message_chunk") {
          const content = asRecord(update.content);
          const contentType = asTrimmedString(content?.type);
          const text = asTrimmedString(content?.text);
          if (contentType === "text" && text) {
            const key = `${threadId}:${turnId}:assistant`;
            let itemId = runtimeItemIds.get(key);
            if (!itemId) {
              itemId = yield* nextItemId;
              runtimeItemIds.set(key, itemId);
              yield* emitItemStarted(threadId, turnId, itemId, "assistant_message");
            }
            yield* emitContentDelta(threadId, turnId, itemId, text, "assistant_text");
          } else if (contentType === "thinking" && text) {
            const key = `${threadId}:${turnId}:thinking`;
            let itemId = runtimeItemIds.get(key);
            if (!itemId) {
              itemId = yield* nextItemId;
              runtimeItemIds.set(key, itemId);
              yield* emitItemStarted(threadId, turnId, itemId, "reasoning");
            }
            yield* emitContentDelta(threadId, turnId, itemId, text, "reasoning_text");
          }
        } else if (kind === "tool_call") {
          const tcId = asTrimmedString(update.toolCallId) ?? (yield* Random.nextUUIDv4);
          const key = toolCallKey(threadId, tcId);
          const rawInput = update.rawInput;
          const inputRecord = asRecord(rawInput);
          const toolName = inferAcpToolName(update.title, rawInput);
          const itemType = classifyToolItemType(toolName, inputRecord);
          const title = titleForTool(itemType);
          const detail = summarizeAcpToolInput(toolName, rawInput);

          let state = toolCalls.get(key);
          if (!state) {
            const itemId = yield* nextItemId;
            const taskId =
              itemType === "collab_agent_tool_call" ? RuntimeTaskId.makeUnsafe(tcId) : null;
            state = {
              key,
              threadId,
              turnId,
              itemId,
              taskId,
              itemType,
              title,
              toolName,
              input: rawInput,
              taskDescription: taskDescriptionFromToolInput(toolName, rawInput, detail),
              ...(detail ? { detail } : {}),
            } satisfies AcpToolCallState;
            toolCalls.set(key, state);
            runtimeItemIds.set(key, itemId);
            yield* emitItemStarted(threadId, turnId, itemId, itemType, {
              title,
              ...(detail ? { detail } : {}),
              data: toolCallData(toolName, rawInput),
            });
            if (taskId) {
              yield* emitTaskStarted(
                threadId,
                turnId,
                taskId,
                state.taskDescription,
                asTrimmedString(inputRecord?.subagent_type),
              );
            }
          }

          if (update.status === "completed" || update.status === "failed") {
            yield* emitToolCallCompletion(state, update.status);
            runtimeItemIds.delete(key);
          }
        } else if (kind === "tool_call_update") {
          const tcId = asTrimmedString(update.toolCallId);
          if (!tcId) {
            return;
          }
          const key = toolCallKey(threadId, tcId);
          const state = toolCalls.get(key);
          if (!state) {
            return;
          }

          const deltas = collectAcpToolOutputDeltas(
            update.rawOutput,
            Array.isArray(update.content) ? update.content : undefined,
          );
          const summary = deltas.join("\n");
          if (summary.length > 0) {
            state.detail = summary;
            yield* emitItemUpdated(threadId, turnId, state.itemId, state.itemType, {
              title: state.title,
              detail: summary,
              data: toolCallData(state.toolName, state.input),
            });
            if (state.taskId) {
              state.lastTaskSummary = summary;
              yield* emitTaskProgress(
                threadId,
                turnId,
                state.taskId,
                state.taskDescription,
                summary,
                state.toolName,
              );
            }
          }

          if (update.status === "completed" || update.status === "failed") {
            yield* emitToolCallCompletion(state, update.status, summary || undefined);
            runtimeItemIds.delete(key);
          }
        } else if (kind === "status" || kind === "error") {
          const status = update as { status?: string; message?: string };
          if (status.message) {
            yield* emitRuntimeError(threadId, turnId, status.message);
          }
        }
      });

    // ── Wire incoming messages from ACP process ─────────────────────

    const wireProcessMessages = (session: AcpSessionState) => {
      session.rl.on("line", (line: string) => {
        if (!line.trim()) return;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(line) as JsonRpcMessage;
        } catch {
          return;
        }

        if (isResponse(msg)) {
          const pending = session.pendingRequests.get(msg.id);
          if (pending) {
            session.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        } else if (isNotification(msg)) {
          if (msg.method === "session/update") {
            const params = (msg.params ?? {}) as Record<string, unknown>;
            Effect.runPromise(handleSessionUpdate(session, params)).catch(() => {});
          } else {
            Effect.runPromise(
              Effect.logDebug("[DroidAdapter] unhandled notification", {
                method: msg.method,
                threadId: session.threadId,
              }),
            ).catch(() => {});
          }
        } else {
          Effect.runPromise(
            Effect.logDebug("[DroidAdapter] unhandled message", {
              hasMethod: "method" in msg,
              hasId: "id" in msg,
              threadId: session.threadId,
            }),
          ).catch(() => {});
        }
      });

      session.process.on("exit", () => {
        session.status = "closed";
        for (const [, pending] of session.pendingRequests) {
          pending.reject(new Error("ACP process exited"));
        }
        session.pendingRequests.clear();
        Effect.runPromise(emitSessionExited(session.threadId)).catch(() => {});
      });

      session.process.stderr?.on("data", () => {});
    };

    // ── ACP initialization handshake ────────────────────────────────

    const initializeAcp = (session: AcpSessionState) =>
      Effect.tryPromise({
        try: async () => {
          const result = (await sendRequest(session, "initialize", {
            protocolVersion: ACP_VERSION,
            client_info: { name: "t3-code", version: "0.1.0" },
            capabilities: {},
          })) as Record<string, unknown> | undefined;
          sendNotification(session, "initialized");
          return result;
        },
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: session.threadId,
            detail: `ACP initialization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      });

    const createAcpSession = (session: AcpSessionState, cwd: string) =>
      Effect.tryPromise({
        try: async () => {
          const result = (await sendRequest(session, "session/new", {
            cwd,
            mcpServers: [],
          })) as { sessionId?: string } | undefined;
          session.acpSessionId = result?.sessionId ?? null;
          return result;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/new",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

    // ── Adapter interface ───────────────────────────────────────────

    const startSession: DroidAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const settings = yield* serverSettingsService.getSettings.pipe(Effect.orDie);
        const binaryPath = settings.providers.droid.binaryPath;
        const cwd = input.cwd ?? process.cwd();

        const model =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
        const reasoningEffort = getDroidReasoningEffort(input);
        const autoLevel = getDroidAutoLevel(input.runtimeMode);
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
        const child = ChildProcess.spawn(binaryPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
          env: { ...process.env },
        });

        if (!child.stdin || !child.stdout) {
          child.kill();
          return yield* new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: "Failed to spawn Droid ACP process: missing stdio",
          });
        }

        const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
        const now = new Date().toISOString();
        const session: AcpSessionState = {
          threadId: input.threadId,
          process: child,
          rl,
          pendingRequests: new Map(),
          nextId: 1,
          acpSessionId: null,
          activeTurnId: null,
          status: "connecting",
          cwd,
          model: input.modelSelection?.model,
          createdAt: now,
        };

        sessions.set(input.threadId, session);
        wireProcessMessages(session);

        yield* initializeAcp(session);
        yield* createAcpSession(session, cwd);

        session.status = "ready";
        yield* emitSessionStarted(input.threadId);

        return {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode ?? "full-access",
          cwd,
          model: input.modelSelection?.model,
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
        } satisfies ProviderSession;
      });

    const sendTurn: DroidAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const session = yield* getSession(input.threadId);
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

        // Fire session/prompt asynchronously -- the response signals turn completion
        Effect.runPromise(
          Effect.tryPromise({
            try: async () => {
              const promptStart = Date.now();
              await sendRequest(session, "session/prompt", {
                sessionId: session.acpSessionId,
                prompt: promptBlocks,
              });
              const elapsed = ((Date.now() - promptStart) / 1000).toFixed(1);
              await Effect.runPromise(
                Effect.logDebug("[DroidAdapter] session/prompt resolved", {
                  threadId: session.threadId,
                  turnId,
                  elapsedSec: elapsed,
                }),
              );

              // Complete assistant message item if still open
              const assistantKey = `${session.threadId}:${turnId}:assistant`;
              const assistantItemId = runtimeItemIds.get(assistantKey);
              if (assistantItemId) {
                await Effect.runPromise(
                  emitItemCompleted(
                    session.threadId,
                    turnId,
                    assistantItemId,
                    "assistant_message",
                    "completed",
                  ),
                );
                runtimeItemIds.delete(assistantKey);
              }

              // Complete thinking item if still open
              const thinkingKey = `${session.threadId}:${turnId}:thinking`;
              const thinkingItemId = runtimeItemIds.get(thinkingKey);
              if (thinkingItemId) {
                await Effect.runPromise(
                  emitItemCompleted(
                    session.threadId,
                    turnId,
                    thinkingItemId,
                    "reasoning",
                    "completed",
                  ),
                );
                runtimeItemIds.delete(thinkingKey);
              }

              await Effect.runPromise(
                closeOpenToolCallsForTurn(session.threadId, turnId, "completed"),
              );

              session.activeTurnId = null;
              session.status = "ready";
              await Effect.runPromise(emitTurnCompleted(session.threadId, turnId, "completed"));
            },
            catch: async (cause) => {
              await Effect.runPromise(
                closeOpenToolCallsForTurn(session.threadId, turnId, "failed"),
              );
              session.activeTurnId = null;
              session.status = "ready";
              const message = cause instanceof Error ? cause.message : String(cause);
              await Effect.runPromise(emitRuntimeError(session.threadId, turnId, message));
              await Effect.runPromise(
                emitTurnCompleted(session.threadId, turnId, "failed", message),
              );
            },
          }),
        ).catch(() => {});

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
              sendRequest(session, "session/cancel", {
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
        session.rl.close();
        session.process.kill();
        session.status = "closed";
        sessions.delete(threadId);
        yield* emitSessionExited(threadId);
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
                runtimeMode: "full-access" as const,
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
      Effect.sync(() => {
        for (const [, session] of sessions) {
          session.rl.close();
          session.process.kill();
          session.status = "closed";
        }
        sessions.clear();
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
