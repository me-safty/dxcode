import * as Sentry from "@sentry/node";
import type { Span } from "@sentry/node";

export interface InvokeAgentSpanInit {
  readonly agentName: string;
  readonly system: string;
  readonly model: string;
  readonly conversationId: string;
  readonly messages?: string;
  readonly availableTools?: ReadonlyArray<string>;
  readonly extraAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface InvokeAgentSpanFinish {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly responseText?: string;
  readonly toolCallsJson?: string;
  readonly errorMessage?: string;
}

const SPAN_STATUS_ERROR = 2 as const;

export function startInvokeAgentSpan(init: InvokeAgentSpanInit, parentSpan?: Span): Span {
  Sentry.setConversationId(init.conversationId);
  const spanOptions = {
    op: "gen_ai.invoke_agent",
    name: `invoke_agent ${init.agentName}`,
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.system": init.system,
      "gen_ai.request.model": init.model,
      "gen_ai.agent.name": init.agentName,
      "gen_ai.conversation.id": init.conversationId,
      ...(init.messages !== undefined ? { "gen_ai.input.messages": init.messages } : {}),
      ...(init.availableTools && init.availableTools.length > 0
        ? { "gen_ai.request.available_tools": JSON.stringify(init.availableTools) }
        : {}),
      ...(init.extraAttributes ?? {}),
    },
  } as const;
  if (parentSpan) {
    return Sentry.withActiveSpan(parentSpan, () => Sentry.startInactiveSpan(spanOptions));
  }
  return Sentry.startInactiveSpan(spanOptions);
}

export function finishInvokeAgentSpan(span: Span | undefined, finish: InvokeAgentSpanFinish): void {
  if (!span) return;
  const attrs: Record<string, string | number | boolean> = {};
  if (finish.inputTokens !== undefined) attrs["gen_ai.usage.input_tokens"] = finish.inputTokens;
  if (finish.outputTokens !== undefined) attrs["gen_ai.usage.output_tokens"] = finish.outputTokens;
  if (finish.totalTokens !== undefined) attrs["gen_ai.usage.total_tokens"] = finish.totalTokens;
  if (finish.cachedInputTokens !== undefined) attrs["gen_ai.usage.input_tokens.cached"] = finish.cachedInputTokens;
  if (finish.cacheWriteInputTokens !== undefined) attrs["gen_ai.usage.input_tokens.cache_write"] = finish.cacheWriteInputTokens;
  if (finish.reasoningOutputTokens !== undefined) attrs["gen_ai.usage.output_tokens.reasoning"] = finish.reasoningOutputTokens;
  if (finish.responseText !== undefined) attrs["gen_ai.response.text"] = finish.responseText;
  if (finish.toolCallsJson !== undefined) attrs["gen_ai.response.tool_calls"] = finish.toolCallsJson;
  span.setAttributes(attrs);
  if (finish.errorMessage !== undefined) {
    span.setStatus({ code: SPAN_STATUS_ERROR, message: finish.errorMessage });
  }
  span.end();
}

// ============================================================================
// gen_ai.request — one per LLM HTTP request
// ============================================================================

export interface GenAiRequestSpanInit {
  readonly model: string;
  readonly messages?: string;
  readonly system?: string;
  readonly conversationId: string;
  readonly availableTools?: ReadonlyArray<string>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly extraAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface GenAiRequestSpanFinish {
  readonly responseText?: string;
  readonly toolCallsJson?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly finishReason?: string;
  readonly errorMessage?: string;
}

export function startGenAiRequestSpan(parent: Span, init: GenAiRequestSpanInit): Span {
  return Sentry.withActiveSpan(parent, () =>
    Sentry.startInactiveSpan({
      op: "gen_ai.request",
      name: `request ${init.model}`,
      attributes: {
        "gen_ai.operation.name": "request",
        "gen_ai.request.model": init.model,
        "gen_ai.conversation.id": init.conversationId,
        ...(init.system !== undefined ? { "gen_ai.system": init.system } : {}),
        ...(init.messages !== undefined ? { "gen_ai.input.messages": init.messages } : {}),
        ...(init.availableTools && init.availableTools.length > 0
          ? { "gen_ai.request.available_tools": JSON.stringify(init.availableTools) }
          : {}),
        ...(init.maxTokens !== undefined ? { "gen_ai.request.max_tokens": init.maxTokens } : {}),
        ...(init.temperature !== undefined ? { "gen_ai.request.temperature": init.temperature } : {}),
        ...(init.topP !== undefined ? { "gen_ai.request.top_p": init.topP } : {}),
        ...(init.extraAttributes ?? {}),
      },
    }),
  );
}

export function finishGenAiRequestSpan(
  span: Span | undefined,
  finish: GenAiRequestSpanFinish,
): void {
  if (!span) return;
  const attrs: Record<string, string | number | boolean> = {};
  if (finish.inputTokens !== undefined) attrs["gen_ai.usage.input_tokens"] = finish.inputTokens;
  if (finish.outputTokens !== undefined) attrs["gen_ai.usage.output_tokens"] = finish.outputTokens;
  if (finish.totalTokens !== undefined) attrs["gen_ai.usage.total_tokens"] = finish.totalTokens;
  if (finish.cachedInputTokens !== undefined) attrs["gen_ai.usage.input_tokens.cached"] = finish.cachedInputTokens;
  if (finish.cacheWriteInputTokens !== undefined) attrs["gen_ai.usage.input_tokens.cache_write"] = finish.cacheWriteInputTokens;
  if (finish.reasoningOutputTokens !== undefined) attrs["gen_ai.usage.output_tokens.reasoning"] = finish.reasoningOutputTokens;
  if (finish.responseText !== undefined) attrs["gen_ai.response.text"] = finish.responseText;
  if (finish.toolCallsJson !== undefined) attrs["gen_ai.response.tool_calls"] = finish.toolCallsJson;
  if (finish.finishReason !== undefined) attrs["gen_ai.response.finish_reasons"] = JSON.stringify([finish.finishReason]);
  span.setAttributes(attrs);
  if (finish.errorMessage !== undefined) {
    span.setStatus({ code: SPAN_STATUS_ERROR, message: finish.errorMessage });
  }
  span.end();
}

// ============================================================================
// gen_ai.execute_tool — one per tool call requested by the model
// ============================================================================

export interface ExecuteToolSpanInit {
  readonly toolName: string;
  readonly toolInput?: string;
  readonly toolType?: string;
  readonly toolDescription?: string;
  readonly extraAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ExecuteToolSpanFinish {
  readonly toolOutput?: string;
  readonly errorMessage?: string;
}

export function startExecuteToolSpan(parent: Span, init: ExecuteToolSpanInit): Span {
  return Sentry.withActiveSpan(parent, () =>
    Sentry.startInactiveSpan({
      op: "gen_ai.execute_tool",
      name: `execute_tool ${init.toolName}`,
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": init.toolName,
        ...(init.toolInput !== undefined ? { "gen_ai.tool.input": init.toolInput } : {}),
        ...(init.toolType !== undefined ? { "gen_ai.tool.type": init.toolType } : {}),
        ...(init.toolDescription !== undefined
          ? { "gen_ai.tool.description": init.toolDescription }
          : {}),
        ...(init.extraAttributes ?? {}),
      },
    }),
  );
}

export function finishExecuteToolSpan(span: Span | undefined, finish: ExecuteToolSpanFinish): void {
  if (!span) return;
  if (finish.toolOutput !== undefined) {
    span.setAttribute("gen_ai.tool.output", finish.toolOutput);
  }
  if (finish.errorMessage !== undefined) {
    span.setStatus({ code: SPAN_STATUS_ERROR, message: finish.errorMessage });
  }
  span.end();
}
