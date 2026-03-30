import type {
  CanonicalItemType,
  EventId,
  ProviderKind,
  ProviderRuntimeEvent,
  RuntimeContentStreamKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { RuntimeTaskId } from "@t3tools/contracts";
import { Effect, Random } from "effect";

import { classifyToolItemType, summarizeToolRequest, titleForTool } from "./toolCallMetadata.ts";

export interface AcpRuntimeSessionState {
  readonly threadId: ThreadId;
  activeTurnId: TurnId | null;
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
  return (
    asTrimmedString(input?.description) ??
    asTrimmedString(input?.prompt) ??
    asTrimmedString(input?.instructions) ??
    detail ??
    `${titleForTool(classifyToolItemType(toolName, input))} in progress`
  );
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

export function makeAcpRuntimeBridge(input: {
  provider: ProviderKind;
  logLabel: string;
  makeStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
  nextItemId: Effect.Effect<RuntimeItemId>;
  offerEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}) {
  const runtimeItemIds = new Map<string, RuntimeItemId>();
  const toolCalls = new Map<string, AcpToolCallState>();

  const runtimeEvent = (event: unknown): ProviderRuntimeEvent => event as ProviderRuntimeEvent;

  const emitContentDelta = (
    threadId: ThreadId,
    turnId: TurnId,
    itemId: RuntimeItemId,
    text: string,
    streamKind: RuntimeContentStreamKind,
  ) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "content.delta",
          eventId: stamp.eventId,
          provider: input.provider,
          threadId,
          turnId,
          itemId,
          createdAt: stamp.createdAt,
          payload: { streamKind, delta: text },
        }),
      );
    });

  const emitItemEvent = (
    type: "item.started" | "item.updated" | "item.completed",
    threadId: ThreadId,
    turnId: TurnId,
    itemId: RuntimeItemId,
    itemType: string,
    status: "inProgress" | "completed" | "failed",
    metadata?: { title?: string; detail?: string; data?: unknown },
  ) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type,
          eventId: stamp.eventId,
          provider: input.provider,
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

  const emitTaskEvent = (
    type: "task.started" | "task.progress" | "task.completed",
    threadId: ThreadId,
    turnId: TurnId,
    taskId: RuntimeTaskId,
    payload: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type,
          eventId: stamp.eventId,
          provider: input.provider,
          threadId,
          turnId,
          createdAt: stamp.createdAt,
          payload: { taskId, ...payload },
        }),
      );
    });

  const emitToolCallCompletion = (
    state: AcpToolCallState,
    status: "completed" | "failed",
    summary?: string,
  ) =>
    Effect.gen(function* () {
      const detail = summary ?? state.detail;
      yield* emitItemEvent(
        "item.completed",
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
        yield* emitTaskEvent("task.completed", state.threadId, state.turnId, state.taskId, {
          status,
          ...((summary ?? state.lastTaskSummary)
            ? { summary: summary ?? state.lastTaskSummary }
            : {}),
        });
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

  const completeOpenStreamItemsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Effect.gen(function* () {
      const keys = [
        { key: `${threadId}:${turnId}:assistant`, itemType: "assistant_message" },
        { key: `${threadId}:${turnId}:thinking`, itemType: "reasoning" },
      ] as const;

      for (const entry of keys) {
        const itemId = runtimeItemIds.get(entry.key);
        if (!itemId) {
          continue;
        }
        yield* emitItemEvent(
          "item.completed",
          threadId,
          turnId,
          itemId,
          entry.itemType,
          "completed",
        );
        runtimeItemIds.delete(entry.key);
      }
    });

  const handleSessionUpdate = (session: AcpRuntimeSessionState, params: Record<string, unknown>) =>
    Effect.gen(function* () {
      const threadId = session.threadId;
      const turnId = session.activeTurnId;
      if (!turnId) {
        return;
      }

      const update = asRecord(params.update);
      if (!update) {
        return;
      }

      const kind = asTrimmedString(update.sessionUpdate);

      yield* Effect.logDebug(input.logLabel, {
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
      });

      if (kind === "agent_message_chunk") {
        const content = asRecord(update.content);
        const contentType = asTrimmedString(content?.type);
        const text = asTrimmedString(content?.text);
        if (contentType === "text" && text) {
          const key = `${threadId}:${turnId}:assistant`;
          let itemId = runtimeItemIds.get(key);
          if (!itemId) {
            itemId = yield* input.nextItemId;
            runtimeItemIds.set(key, itemId);
            yield* emitItemEvent(
              "item.started",
              threadId,
              turnId,
              itemId,
              "assistant_message",
              "inProgress",
            );
          }
          yield* emitContentDelta(threadId, turnId, itemId, text, "assistant_text");
        } else if (contentType === "thinking" && text) {
          const key = `${threadId}:${turnId}:thinking`;
          let itemId = runtimeItemIds.get(key);
          if (!itemId) {
            itemId = yield* input.nextItemId;
            runtimeItemIds.set(key, itemId);
            yield* emitItemEvent(
              "item.started",
              threadId,
              turnId,
              itemId,
              "reasoning",
              "inProgress",
            );
          }
          yield* emitContentDelta(threadId, turnId, itemId, text, "reasoning_text");
        }
        return;
      }

      if (kind === "tool_call") {
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
          const itemId = yield* input.nextItemId;
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
          yield* emitItemEvent("item.started", threadId, turnId, itemId, itemType, "inProgress", {
            title,
            ...(detail ? { detail } : {}),
            data: toolCallData(toolName, rawInput),
          });
          if (taskId) {
            yield* emitTaskEvent("task.started", threadId, turnId, taskId, {
              description: state.taskDescription,
              ...(asTrimmedString(inputRecord?.subagent_type)
                ? { taskType: asTrimmedString(inputRecord?.subagent_type) }
                : {}),
            });
          }
        }

        if (update.status === "completed" || update.status === "failed") {
          yield* emitToolCallCompletion(state, update.status);
          runtimeItemIds.delete(key);
        }
        return;
      }

      if (kind === "tool_call_update") {
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
          yield* emitItemEvent(
            "item.updated",
            threadId,
            turnId,
            state.itemId,
            state.itemType,
            "inProgress",
            {
              title: state.title,
              detail: summary,
              data: toolCallData(state.toolName, state.input),
            },
          );
          if (state.taskId) {
            state.lastTaskSummary = summary;
            yield* emitTaskEvent("task.progress", threadId, turnId, state.taskId, {
              description: state.taskDescription,
              summary,
              lastToolName: state.toolName,
            });
          }
        }

        if (update.status === "completed" || update.status === "failed") {
          yield* emitToolCallCompletion(state, update.status, summary || undefined);
          runtimeItemIds.delete(key);
        }
        return;
      }

      if ((kind === "status" || kind === "error") && asTrimmedString(update.message)) {
        const stamp = yield* input.makeStamp();
        yield* input.offerEvent(
          runtimeEvent({
            type: "runtime.error",
            eventId: stamp.eventId,
            provider: input.provider,
            threadId,
            turnId,
            createdAt: stamp.createdAt,
            payload: {
              class: "provider_error",
              message: asTrimmedString(update.message),
            },
          }),
        );
      }
    });

  const emitSessionStarted = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "session.started",
          eventId: stamp.eventId,
          provider: input.provider,
          threadId,
          createdAt: stamp.createdAt,
          payload: {},
        }),
      );
    });

  const emitTurnStarted = (threadId: ThreadId, turnId: TurnId, model?: string, effort?: string) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "turn.started",
          eventId: stamp.eventId,
          provider: input.provider,
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
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "turn.completed",
          eventId: stamp.eventId,
          provider: input.provider,
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

  const emitRuntimeError = (threadId: ThreadId, turnId: TurnId | undefined, message: string) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "runtime.error",
          eventId: stamp.eventId,
          provider: input.provider,
          threadId,
          turnId,
          createdAt: stamp.createdAt,
          payload: { class: "provider_error", message },
        }),
      );
    });

  const emitSessionExited = (threadId: ThreadId, reason?: string) =>
    Effect.gen(function* () {
      const stamp = yield* input.makeStamp();
      yield* input.offerEvent(
        runtimeEvent({
          type: "session.exited",
          eventId: stamp.eventId,
          provider: input.provider,
          threadId,
          createdAt: stamp.createdAt,
          payload: {
            ...(reason ? { reason } : {}),
            exitKind: "graceful",
          },
        }),
      );
    });

  return {
    emitSessionStarted,
    emitTurnStarted,
    emitTurnCompleted,
    emitRuntimeError,
    emitSessionExited,
    handleSessionUpdate,
    closeOpenToolCallsForTurn,
    completeOpenStreamItemsForTurn,
  };
}
