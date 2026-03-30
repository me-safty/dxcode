/**
 * FactoryDroidRuntimeEvents - Notification-to-event mapper for Factory Droid.
 *
 * @module FactoryDroidRuntimeEvents
 */
import { randomUUID } from "node:crypto";
import {
  EventId,
  type ProviderRuntimeEvent,
  RuntimeTaskId,
  type ThreadTokenUsageSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export const FACTORY_DROID_PROVIDER = "factoryDroid" as const;
const RAW_SOURCE = "factorydroid.jsonrpc.notification";

const now = () => new Date().toISOString();
const nextEventId = () => EventId.makeUnsafe(randomUUID());

/** @internal */
export const asObj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export function makeFactoryDroidBaseEvent(threadId: ThreadId) {
  return {
    eventId: nextEventId(),
    provider: FACTORY_DROID_PROVIDER,
    threadId,
    createdAt: now(),
  } as const;
}

export function makeFactoryDroidContentDeltaEvent(
  threadId: ThreadId,
  turnId: TurnId,
  streamKind: "assistant_text" | "reasoning_text",
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

function runtimeEventWithRaw(
  threadId: ThreadId,
  notifType: string,
  notif: Record<string, unknown>,
  refs?: { turnId?: TurnId; itemId?: string },
) {
  const providerRefs = {
    ...(refs?.turnId ? { providerTurnId: refs.turnId } : {}),
    ...(refs?.itemId ? { providerItemId: refs.itemId } : {}),
  };
  return {
    ...makeFactoryDroidBaseEvent(threadId),
    ...(refs?.turnId ? { turnId: refs.turnId } : {}),
    ...(refs?.itemId ? { itemId: refs.itemId } : {}),
    ...(Object.keys(providerRefs).length > 0 ? { providerRefs } : {}),
    raw: { source: RAW_SOURCE, method: notifType, payload: notif },
  };
}

export interface ToolUseEntry {
  readonly itemType: string;
  readonly title: string;
}

interface NotifInput {
  readonly notif: Record<string, unknown>;
  readonly sawAssistantTextDelta: boolean;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly toolUseRegistry?: Map<string, ToolUseEntry>;
}

interface NotifResult {
  readonly events: ReadonlyArray<ProviderRuntimeEvent>;
  readonly fallbackText: string;
}

const EMPTY: NotifResult = { events: [], fallbackText: "" };

function toolNameToItemType(name: string) {
  const l = name.toLowerCase();
  if (/task|subagent|sub.agent|agent|dispatch|delegate/.test(l)) return "collab_agent_tool_call";
  if (/execute|bash|shell|command|^run$/.test(l)) return "command_execution";
  if (/write|create|edit|multiedit|patch|delete/.test(l)) return "file_change";
  if (/search|web|fetch/.test(l)) return "web_search";
  return l.includes("mcp") ? "mcp_tool_call" : "dynamic_tool_call";
}

export function mapFactoryDroidNotification(input: NotifInput): NotifResult {
  const type = input.notif.type as string;
  if (!type) return EMPTY;

  if (type === "create_message" && input.turnId) {
    const msg = asObj(input.notif.message);
    const content =
      msg && (msg.role as string) === "assistant" && Array.isArray(msg.content)
        ? (msg.content as Array<Record<string, unknown>>)
        : undefined;
    if (!content) return EMPTY;

    const events: ProviderRuntimeEvent[] = [];
    let fallbackText = "";
    for (const block of content) {
      if ((block.type as string) === "tool_use") {
        const toolName = (block.name as string) ?? "tool";
        const itemType = toolNameToItemType(toolName);
        const toolInput = asObj(block.input);
        const itemId = (block.id as string) ?? randomUUID();

        // Register the tool use so tool_result can look up the original itemType.
        if (input.toolUseRegistry) {
          input.toolUseRegistry.set(itemId, {
            itemType,
            title:
              itemType === "collab_agent_tool_call"
                ? "Subagent task"
                : itemType === "command_execution"
                  ? `Ran command: ${toolName}`
                  : itemType === "file_change"
                    ? `File change: ${toolName}`
                    : toolName,
          });
        }
        const detail =
          itemType === "collab_agent_tool_call"
            ? ((toolInput?.description as string) ?? (toolInput?.prompt as string) ?? toolName)
            : itemType === "file_change"
              ? ((toolInput?.file_path as string) ?? (toolInput?.path as string))
              : itemType === "command_execution"
                ? ((toolInput?.command as string) ?? toolName)
                : ((toolInput?.file_path as string) ??
                  (toolInput?.path as string) ??
                  (toolInput?.pattern as string));
        events.push({
          ...runtimeEventWithRaw(input.threadId, "create_message", msg!, {
            turnId: input.turnId,
            itemId,
          }),
          type: "item.started",
          payload: {
            itemType,
            status: "inProgress",
            title:
              itemType === "collab_agent_tool_call"
                ? "Subagent task"
                : itemType === "command_execution"
                  ? `Ran command: ${toolName}`
                  : itemType === "file_change"
                    ? `File change: ${toolName}`
                    : toolName,
            ...(detail ? { detail } : {}),
          },
        } as unknown as ProviderRuntimeEvent);
      } else if (!input.sawAssistantTextDelta && (block.type as string) === "text") {
        fallbackText += (block.text as string) ?? "";
      }
    }
    return { events, fallbackText };
  }

  if (type === "tool_result" && input.turnId) {
    const itemId = (input.notif.toolUseId as string) ?? randomUUID();
    const detail = input.notif.content as string;
    const registered = input.toolUseRegistry?.get(itemId);
    input.toolUseRegistry?.delete(itemId);
    const itemType = registered?.itemType ?? "dynamic_tool_call";
    const title = registered?.title ?? "Tool";
    return {
      events: [
        {
          ...runtimeEventWithRaw(input.threadId, type, input.notif, {
            turnId: input.turnId,
            itemId,
          }),
          type: "item.completed",
          payload: {
            itemType,
            status: "completed",
            title,
            ...(detail ? { detail: detail.slice(0, 200) } : {}),
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if (type === "session_title_updated") {
    const title = input.notif.title as string;
    return title
      ? {
          events: [
            {
              ...runtimeEventWithRaw(input.threadId, type, input.notif),
              type: "thread.metadata.updated",
              payload: { name: title },
            } as unknown as ProviderRuntimeEvent,
          ],
          fallbackText: "",
        }
      : EMPTY;
  }

  if (type === "session_token_usage_changed") {
    const raw = asObj(input.notif.tokenUsage);
    if (!raw) return EMPTY;
    const inp = (raw.inputTokens as number) ?? 0;
    const out = (raw.outputTokens as number) ?? 0;
    const cached = (raw.cacheReadTokens as number) ?? 0;
    const reasoning = (raw.thinkingTokens as number) ?? 0;
    const used = inp + out + cached + reasoning;
    if (used <= 0) return EMPTY;
    const usage: ThreadTokenUsageSnapshot = {
      usedTokens: used,
      ...(inp > 0 ? { inputTokens: inp } : {}),
      ...(out > 0 ? { outputTokens: out } : {}),
      ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      ...(reasoning > 0 ? { reasoningOutputTokens: reasoning } : {}),
    };
    return {
      events: [
        {
          ...runtimeEventWithRaw(input.threadId, type, input.notif),
          type: "thread.token-usage.updated",
          payload: { usage },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if (type === "task_started" && input.turnId) {
    const taskId =
      (input.notif.taskId as string) ?? (input.notif.task_id as string) ?? randomUUID();
    return {
      events: [
        {
          ...runtimeEventWithRaw(input.threadId, type, input.notif, { turnId: input.turnId }),
          type: "task.started",
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(taskId),
            ...((input.notif.description as string)
              ? { description: input.notif.description as string }
              : {}),
            ...(((input.notif.taskType as string) ?? (input.notif.task_type as string))
              ? { taskType: (input.notif.taskType as string) ?? (input.notif.task_type as string) }
              : {}),
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if (type === "task_progress" && input.turnId) {
    const taskId =
      (input.notif.taskId as string) ?? (input.notif.task_id as string) ?? randomUUID();
    const desc =
      (input.notif.description as string) ?? (input.notif.summary as string) ?? "Working...";
    return {
      events: [
        {
          ...runtimeEventWithRaw(input.threadId, type, input.notif, { turnId: input.turnId }),
          type: "task.progress",
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(taskId),
            description: desc,
            ...((input.notif.summary as string) ? { summary: input.notif.summary as string } : {}),
            ...(((input.notif.lastToolName as string) ?? (input.notif.last_tool_name as string))
              ? {
                  lastToolName:
                    (input.notif.lastToolName as string) ?? (input.notif.last_tool_name as string),
                }
              : {}),
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if ((type === "task_completed" || type === "task_notification") && input.turnId) {
    const taskId =
      (input.notif.taskId as string) ?? (input.notif.task_id as string) ?? randomUUID();
    const status = (input.notif.status as string) === "failed" ? "failed" : "completed";
    return {
      events: [
        {
          ...runtimeEventWithRaw(input.threadId, type, input.notif, { turnId: input.turnId }),
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.makeUnsafe(taskId),
            status,
            ...((input.notif.summary as string) ? { summary: input.notif.summary as string } : {}),
          },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  if (type === "error") {
    return {
      events: [
        {
          ...runtimeEventWithRaw(
            input.threadId,
            type,
            input.notif,
            input.turnId ? { turnId: input.turnId } : undefined,
          ),
          type: "runtime.error",
          payload: { message: (input.notif.message as string) ?? "Droid runtime error" },
        } as unknown as ProviderRuntimeEvent,
      ],
      fallbackText: "",
    };
  }

  return EMPTY;
}
