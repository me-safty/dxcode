import { randomUUID } from "node:crypto";
import {
  EventId,
  type ProviderRuntimeEvent,
  type ProviderRuntimeEventBase,
  type ThreadTokenUsageSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export const FACTORY_DROID_PROVIDER = "factoryDroid" as const;
const FACTORY_DROID_RAW_SOURCE = "factorydroid.jsonrpc.notification";

interface FactoryDroidNotificationInput {
  readonly notif: Record<string, unknown>;
  readonly sawAssistantTextDelta: boolean;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}

interface FactoryDroidNotificationResult {
  readonly events: ReadonlyArray<ProviderRuntimeEvent>;
  readonly fallbackText: string;
}

const EMPTY_NOTIFICATION_RESULT: FactoryDroidNotificationResult = {
  events: [],
  fallbackText: "",
};

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
  itemId?: string,
): ProviderRuntimeEvent {
  return {
    ...makeFactoryDroidBaseEvent(threadId),
    type: "content.delta",
    turnId,
    ...(itemId ? { itemId } : {}),
    payload: { streamKind, delta },
  } as unknown as ProviderRuntimeEvent;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function runtimeEventBase(
  threadId: ThreadId,
  notifType: string,
  notif: Record<string, unknown>,
  refs?: {
    readonly turnId?: TurnId;
    readonly itemId?: string;
    readonly requestId?: string;
  },
): Omit<ProviderRuntimeEventBase, "providerRefs" | "raw"> & {
  providerRefs?: ProviderRuntimeEvent["providerRefs"];
  raw: NonNullable<ProviderRuntimeEvent["raw"]>;
} {
  const providerRefs = {
    ...(refs?.turnId ? { providerTurnId: refs.turnId } : {}),
    ...(refs?.itemId ? { providerItemId: refs.itemId } : {}),
    ...(refs?.requestId ? { providerRequestId: refs.requestId } : {}),
  };

  return {
    ...makeFactoryDroidBaseEvent(threadId),
    ...(refs?.turnId ? { turnId: refs.turnId } : {}),
    ...(refs?.itemId ? { itemId: refs.itemId } : {}),
    ...(refs?.requestId ? { requestId: refs.requestId } : {}),
    ...(Object.keys(providerRefs).length > 0 ? { providerRefs } : {}),
    raw: {
      source: FACTORY_DROID_RAW_SOURCE,
      method: notifType,
      payload: notif,
    },
  };
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
  return lower.includes("mcp") ? "mcp_tool_call" : "dynamic_tool_call";
}

function mapCreateMessage(input: {
  readonly message: Record<string, unknown> | undefined;
  readonly sawAssistantTextDelta: boolean;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}): FactoryDroidNotificationResult {
  if (!input.message) {
    return EMPTY_NOTIFICATION_RESULT;
  }

  const role = asString(input.message.role);
  const content = Array.isArray(input.message.content)
    ? (input.message.content as Array<Record<string, unknown>>)
    : undefined;
  if (role !== "assistant" || !content) {
    return EMPTY_NOTIFICATION_RESULT;
  }

  const events: ProviderRuntimeEvent[] = [];
  let fallbackText = "";

  for (const block of content) {
    if (asString(block.type) === "tool_use") {
      const toolName = asString(block.name) ?? "tool";
      const itemType = droidToolNameToItemType(toolName);
      const toolInput = asObject(block.input);
      const itemId = asString(block.id) ?? randomUUID();
      const detail =
        itemType === "file_change"
          ? (asString(toolInput?.file_path) ?? asString(toolInput?.path))
          : itemType === "command_execution"
            ? (asString(toolInput?.command) ?? toolName)
            : (asString(toolInput?.file_path) ??
              asString(toolInput?.path) ??
              asString(toolInput?.pattern) ??
              undefined);
      events.push({
        ...runtimeEventBase(input.threadId, "create_message", input.message, {
          turnId: input.turnId,
          itemId,
        }),
        type: "item.started",
        payload: {
          itemType,
          status: "inProgress",
          title:
            itemType === "command_execution"
              ? `Ran command: ${toolName}`
              : itemType === "file_change"
                ? `File change: ${toolName}`
                : toolName,
          ...(detail ? { detail } : {}),
        },
      } as unknown as ProviderRuntimeEvent);
      continue;
    }

    if (!input.sawAssistantTextDelta && asString(block.type) === "text") {
      fallbackText += asString(block.text) ?? "";
    }
  }

  return { events, fallbackText };
}

function toTokenUsage(
  tokenUsage: Record<string, unknown> | undefined,
): ThreadTokenUsageSnapshot | undefined {
  if (!tokenUsage) {
    return undefined;
  }

  const inputTokens = asNumber(tokenUsage.inputTokens) ?? 0;
  const outputTokens = asNumber(tokenUsage.outputTokens) ?? 0;
  const cachedInputTokens = asNumber(tokenUsage.cacheReadTokens) ?? 0;
  const reasoningOutputTokens = asNumber(tokenUsage.thinkingTokens) ?? 0;
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

export function mapFactoryDroidNotification(
  input: FactoryDroidNotificationInput,
): FactoryDroidNotificationResult {
  const notifType = asString(input.notif.type);
  if (!notifType) {
    return EMPTY_NOTIFICATION_RESULT;
  }

  if (notifType === "create_message" && input.turnId) {
    return mapCreateMessage({
      message: asObject(input.notif.message),
      sawAssistantTextDelta: input.sawAssistantTextDelta,
      threadId: input.threadId,
      turnId: input.turnId,
    });
  }

  if (notifType === "tool_result" && input.turnId) {
    const itemId = asString(input.notif.toolUseId) ?? randomUUID();
    const detail = asString(input.notif.content);
    return {
      events: [
        {
          ...runtimeEventBase(input.threadId, notifType, input.notif, {
            turnId: input.turnId,
            itemId,
          }),
          type: "item.completed",
          payload: {
            itemType: "dynamic_tool_call",
            status: "completed",
            title: "Tool",
            ...(detail ? { detail: detail.slice(0, 200) } : {}),
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if (notifType === "session_title_updated") {
    const title = asString(input.notif.title);
    return title
      ? {
          events: [
            {
              ...runtimeEventBase(input.threadId, notifType, input.notif),
              type: "thread.metadata.updated",
              payload: { name: title },
            } as unknown as ProviderRuntimeEvent,
          ],
          fallbackText: "",
        }
      : EMPTY_NOTIFICATION_RESULT;
  }

  if (notifType === "session_token_usage_changed") {
    const usage = toTokenUsage(asObject(input.notif.tokenUsage));
    return usage
      ? {
          events: [
            {
              ...runtimeEventBase(input.threadId, notifType, input.notif),
              type: "thread.token-usage.updated",
              payload: { usage },
            } as unknown as ProviderRuntimeEvent,
          ],
          fallbackText: "",
        }
      : EMPTY_NOTIFICATION_RESULT;
  }

  if (notifType === "error") {
    return {
      events: [
        {
          ...runtimeEventBase(input.threadId, notifType, input.notif, {
            ...(input.turnId ? { turnId: input.turnId } : {}),
          }),
          type: "runtime.error",
          payload: {
            message: asString(input.notif.message) ?? "Droid runtime error",
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  return EMPTY_NOTIFICATION_RESULT;
}
