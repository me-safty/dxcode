import * as Sentry from "@sentry/node";
import type { Span } from "@sentry/node";

export interface InvokeAgentSpanInit {
  readonly agentName: string;
  readonly system: string;
  readonly model: string;
  readonly conversationId?: string;
  /** Stringified messages array sent to the model. Sentry caps attribute size. */
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

// OpenTelemetry SpanStatusCode.ERROR. Avoids importing @opentelemetry/api
// just for the constant; Sentry's Span.setStatus accepts the numeric code.
const SPAN_STATUS_ERROR = 2 as const;

export function startInvokeAgentSpan(init: InvokeAgentSpanInit): Span {
  if (init.conversationId !== undefined) {
    // Per Sentry's docs (https://docs.sentry.io/platforms/javascript/guides/node/ai-agent-monitoring/#tracking-conversations),
    // setConversationId tags the current scope so all subsequent AI spans
    // (and Logs/errors) are linked to this conversation in the AI Agents view.
    // Caveat: the scope is process-wide. For concurrent turns from different
    // threads the most recent caller wins — acceptable for the local-first
    // single-user model t3code targets, but a multi-tenant server would need
    // per-turn isolation via Sentry.withIsolationScope.
    Sentry.setConversationId(init.conversationId);
  }
  return Sentry.startInactiveSpan({
    op: "gen_ai.invoke_agent",
    name: `invoke_agent ${init.agentName}`,
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.system": init.system,
      "gen_ai.request.model": init.model,
      "gen_ai.agent.name": init.agentName,
      ...(init.conversationId !== undefined
        ? { "gen_ai.conversation.id": init.conversationId }
        : {}),
      ...(init.messages !== undefined ? { "gen_ai.request.messages": init.messages } : {}),
      ...(init.availableTools && init.availableTools.length > 0
        ? { "gen_ai.request.available_tools": JSON.stringify(init.availableTools) }
        : {}),
      ...(init.extraAttributes ?? {}),
    },
  });
}

export function finishInvokeAgentSpan(span: Span | undefined, finish: InvokeAgentSpanFinish): void {
  if (!span) return;
  if (finish.inputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens", finish.inputTokens);
  }
  if (finish.outputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens", finish.outputTokens);
  }
  if (finish.totalTokens !== undefined) {
    span.setAttribute("gen_ai.usage.total_tokens", finish.totalTokens);
  }
  if (finish.cachedInputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens.cached", finish.cachedInputTokens);
  }
  if (finish.cacheWriteInputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens.cache_write", finish.cacheWriteInputTokens);
  }
  if (finish.reasoningOutputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens.reasoning", finish.reasoningOutputTokens);
  }
  if (finish.responseText !== undefined) {
    span.setAttribute("gen_ai.response.text", finish.responseText);
  }
  if (finish.toolCallsJson !== undefined) {
    span.setAttribute("gen_ai.response.tool_calls", finish.toolCallsJson);
  }
  if (finish.errorMessage !== undefined) {
    span.setStatus({ code: SPAN_STATUS_ERROR, message: finish.errorMessage });
  }
  span.end();
}

// ============================================================================
// gen_ai.request — one per LLM HTTP request (i.e. per assistant turn)
// ============================================================================

export interface GenAiRequestSpanInit {
  readonly model: string;
  /** Stringified messages array sent to the model. Sentry caps attribute size. */
  readonly messages?: string;
  readonly system?: string;
  readonly conversationId?: string;
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
  /** e.g. Anthropic stop_reason: "end_turn" | "tool_use" | "max_tokens" | ... */
  readonly finishReason?: string;
  readonly errorMessage?: string;
}

/**
 * Opens a `gen_ai.request` child span. Caller must pass the parent
 * `gen_ai.invoke_agent` span explicitly so concurrent turns in a multi-session
 * server cannot accidentally adopt the wrong active scope as parent.
 */
export function startGenAiRequestSpan(parent: Span, init: GenAiRequestSpanInit): Span {
  return Sentry.withActiveSpan(parent, () =>
    Sentry.startInactiveSpan({
      op: "gen_ai.request",
      name: `request ${init.model}`,
      attributes: {
        "gen_ai.operation.name": "request",
        "gen_ai.request.model": init.model,
        ...(init.system !== undefined ? { "gen_ai.system": init.system } : {}),
        ...(init.messages !== undefined ? { "gen_ai.request.messages": init.messages } : {}),
        ...(init.conversationId !== undefined
          ? { "gen_ai.conversation.id": init.conversationId }
          : {}),
        ...(init.availableTools && init.availableTools.length > 0
          ? { "gen_ai.request.available_tools": JSON.stringify(init.availableTools) }
          : {}),
        ...(init.maxTokens !== undefined ? { "gen_ai.request.max_tokens": init.maxTokens } : {}),
        ...(init.temperature !== undefined
          ? { "gen_ai.request.temperature": init.temperature }
          : {}),
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
  if (finish.inputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens", finish.inputTokens);
  }
  if (finish.outputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens", finish.outputTokens);
  }
  if (finish.totalTokens !== undefined) {
    span.setAttribute("gen_ai.usage.total_tokens", finish.totalTokens);
  }
  if (finish.cachedInputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens.cached", finish.cachedInputTokens);
  }
  if (finish.cacheWriteInputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens.cache_write", finish.cacheWriteInputTokens);
  }
  if (finish.reasoningOutputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens.reasoning", finish.reasoningOutputTokens);
  }
  if (finish.responseText !== undefined) {
    span.setAttribute("gen_ai.response.text", finish.responseText);
  }
  if (finish.toolCallsJson !== undefined) {
    span.setAttribute("gen_ai.response.tool_calls", finish.toolCallsJson);
  }
  if (finish.finishReason !== undefined) {
    span.setAttribute("gen_ai.response.finish_reasons", JSON.stringify([finish.finishReason]));
  }
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
  /** Stringified tool input payload. Sentry caps attribute size. */
  readonly toolInput?: string;
  /** "function" | "extension" | "datastore" | provider-specific (e.g. "mcp") */
  readonly toolType?: string;
  readonly toolDescription?: string;
  readonly extraAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ExecuteToolSpanFinish {
  /** Stringified tool output. Sentry caps attribute size. */
  readonly toolOutput?: string;
  readonly errorMessage?: string;
}

/**
 * Opens a `gen_ai.execute_tool` child span. Caller must pass the parent
 * `gen_ai.invoke_agent` span explicitly (see startGenAiRequestSpan).
 */
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
