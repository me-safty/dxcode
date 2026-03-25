import { randomUUID } from "node:crypto";
import {
  EventId,
  type ProviderRuntimeEvent,
  type ThreadTokenUsageSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export const FACTORY_DROID_PROVIDER = "factoryDroid" as const;

interface FactoryDroidCreateMessageInput {
  readonly message: Record<string, unknown> | undefined;
  readonly sawAssistantTextDelta: boolean;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}

interface FactoryDroidToolResultInput {
  readonly content: string | undefined;
  readonly threadId: ThreadId;
  readonly toolUseId: string;
  readonly turnId: TurnId;
}

interface FactoryDroidRuntimeErrorInput {
  readonly message: string;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}

interface FactoryDroidCreateMessageResult {
  readonly events: ReadonlyArray<ProviderRuntimeEvent>;
  readonly fallbackText: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextEventId(): EventId {
  return EventId.makeUnsafe(randomUUID());
}

export function makeFactoryDroidBaseEvent(threadId: ThreadId) {
  return {
    eventId: nextEventId(),
    provider: FACTORY_DROID_PROVIDER,
    threadId,
    createdAt: nowIso(),
  } as const;
}

export function makeFactoryDroidContentDeltaEvent(
  threadId: ThreadId,
  turnId: TurnId,
  streamKind: "assistant_text" | "reasoning",
  delta: string,
): ProviderRuntimeEvent {
  return {
    ...makeFactoryDroidBaseEvent(threadId),
    type: "content.delta",
    turnId,
    payload: { streamKind, delta },
  } as unknown as ProviderRuntimeEvent;
}

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
  ) {
    return "command_execution";
  }
  if (
    lower.includes("write") ||
    lower.includes("create") ||
    lower.includes("edit") ||
    lower.includes("multiedit") ||
    lower.includes("patch") ||
    lower.includes("delete")
  ) {
    return "file_change";
  }
  if (lower.includes("search") || lower.includes("web") || lower.includes("fetch")) {
    return "web_search";
  }
  if (lower.includes("mcp")) {
    return "mcp_tool_call";
  }
  return "dynamic_tool_call";
}

function droidToolTitle(toolName: string, itemType: string): string {
  if (itemType === "command_execution") {
    return `Ran command: ${toolName}`;
  }
  if (itemType === "file_change") {
    return `File change: ${toolName}`;
  }
  return toolName;
}

function droidToolDetail(
  itemType: string,
  input: Record<string, unknown> | undefined,
  toolName: string,
): string | undefined {
  if (itemType === "file_change") {
    return (input?.file_path as string) ?? (input?.path as string);
  }
  if (itemType === "command_execution") {
    return (input?.command as string) ?? toolName;
  }
  return (
    (input?.file_path as string) ??
    (input?.path as string) ??
    (input?.pattern as string) ??
    undefined
  );
}

export function mapFactoryDroidCreateMessage(
  input: FactoryDroidCreateMessageInput,
): FactoryDroidCreateMessageResult {
  if (!input.message) {
    return { events: [], fallbackText: "" };
  }

  const role = input.message.role as string;
  const content = input.message.content as Array<Record<string, unknown>> | undefined;
  if (role !== "assistant" || !Array.isArray(content)) {
    return { events: [], fallbackText: "" };
  }

  const events: ProviderRuntimeEvent[] = [];
  let fallbackText = "";

  for (const block of content) {
    if (block.type === "tool_use") {
      const toolName = (block.name as string) ?? "tool";
      const toolUseId = (block.id as string) ?? randomUUID();
      const toolInput = block.input as Record<string, unknown> | undefined;
      const itemType = droidToolNameToItemType(toolName);
      const detail = droidToolDetail(itemType, toolInput, toolName);

      events.push({
        ...makeFactoryDroidBaseEvent(input.threadId),
        type: "item.started",
        turnId: input.turnId,
        itemId: toolUseId,
        payload: {
          itemType,
          status: "inProgress",
          title: droidToolTitle(toolName, itemType),
          ...(detail ? { detail } : {}),
        },
      } as unknown as ProviderRuntimeEvent);
      continue;
    }

    if (!input.sawAssistantTextDelta && block.type === "text") {
      fallbackText += (block.text as string) ?? "";
    }
  }

  return { events, fallbackText };
}

export function makeFactoryDroidToolResultEvent(
  input: FactoryDroidToolResultInput,
): ProviderRuntimeEvent {
  return {
    ...makeFactoryDroidBaseEvent(input.threadId),
    type: "item.completed",
    turnId: input.turnId,
    itemId: input.toolUseId,
    payload: {
      itemType: "dynamic_tool_call",
      status: "completed",
      title: "Tool",
      ...(input.content ? { detail: input.content.slice(0, 200) } : {}),
    },
  } as unknown as ProviderRuntimeEvent;
}

function toFactoryDroidTokenUsageSnapshot(
  tokenUsage: Record<string, unknown> | undefined,
): ThreadTokenUsageSnapshot | undefined {
  if (!tokenUsage) {
    return undefined;
  }

  const inputTokens = (tokenUsage.inputTokens as number) ?? 0;
  const outputTokens = (tokenUsage.outputTokens as number) ?? 0;
  const cachedInputTokens = (tokenUsage.cacheReadTokens as number) ?? 0;
  const reasoningOutputTokens = (tokenUsage.thinkingTokens as number) ?? 0;
  const usedTokens = inputTokens + outputTokens + cachedInputTokens + reasoningOutputTokens;

  if (usedTokens <= 0) {
    return undefined;
  }

  return {
    usedTokens,
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
  };
}

export function makeFactoryDroidTokenUsageEvent(
  threadId: ThreadId,
  tokenUsage: Record<string, unknown> | undefined,
): ProviderRuntimeEvent | undefined {
  const usage = toFactoryDroidTokenUsageSnapshot(tokenUsage);
  if (!usage) {
    return undefined;
  }

  return {
    ...makeFactoryDroidBaseEvent(threadId),
    type: "thread.token-usage.updated",
    payload: { usage },
  } as unknown as ProviderRuntimeEvent;
}

export function makeFactoryDroidThreadMetadataUpdatedEvent(
  threadId: ThreadId,
  title: string,
): ProviderRuntimeEvent {
  return {
    ...makeFactoryDroidBaseEvent(threadId),
    type: "thread.metadata.updated",
    payload: { name: title },
  } as unknown as ProviderRuntimeEvent;
}

export function makeFactoryDroidRuntimeErrorEvent(
  input: FactoryDroidRuntimeErrorInput,
): ProviderRuntimeEvent {
  return {
    ...makeFactoryDroidBaseEvent(input.threadId),
    type: "runtime.error",
    ...(input.turnId ? { turnId: input.turnId } : {}),
    payload: { message: input.message },
  } as unknown as ProviderRuntimeEvent;
}
