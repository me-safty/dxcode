export interface ChatCompletionsChunk {
  id: string;
  object: "chat.completion.chunk";
  model: string;
  choices: ChatCompletionsChunkChoice[];
  usage?: ChatCompletionsUsage | null;
}

interface ChatCompletionsChunkChoice {
  index: number;
  delta: ChatCompletionsDelta;
  finish_reason: string | null;
}

interface ChatCompletionsDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: ChatCompletionsToolCallDelta[];
}

interface ChatCompletionsToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatCompletionsUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ResponsesSSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export class GlmToResponsesTranslator {
  private readonly responseId: string;
  private outputIndex = 0;
  private pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  private emittedItemStartForText = false;

  constructor(responseId: string) {
    this.responseId = responseId;
  }

  translateChunk(chunk: ChatCompletionsChunk): ResponsesSSEEvent[] {
    const events: ResponsesSSEEvent[] = [];
    const choice = chunk.choices[0];
    if (!choice) return events;

    const { delta, finish_reason } = choice;

    if (delta.content) {
      if (!this.emittedItemStartForText) {
        events.push({
          event: "response.output_item.added",
          data: {
            output_index: this.outputIndex,
            item: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "" }],
            },
          },
        });
        this.emittedItemStartForText = true;
      }

      events.push({
        event: "response.output_text.delta",
        data: {
          output_index: this.outputIndex,
          content_index: 0,
          delta: delta.content,
        },
      });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        let pending = this.pendingToolCalls.get(tc.index);
        if (!pending) {
          pending = { id: tc.id ?? "", name: "", arguments: "" };
          this.pendingToolCalls.set(tc.index, pending);
        }
        if (tc.id) pending.id = tc.id;
        if (tc.function?.name) pending.name += tc.function.name;
        if (tc.function?.arguments) pending.arguments += tc.function.arguments;
      }
    }

    if (finish_reason) {
      if (this.emittedItemStartForText) {
        events.push({
          event: "response.output_text.done",
          data: { output_index: this.outputIndex, content_index: 0 },
        });
        events.push({
          event: "response.output_item.done",
          data: { output_index: this.outputIndex },
        });
        this.outputIndex++;
      }

      for (const [, toolCall] of this.pendingToolCalls) {
        events.push({
          event: "response.output_item.added",
          data: {
            output_index: this.outputIndex,
            item: {
              type: "function_call",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        });
        events.push({
          event: "response.output_item.done",
          data: {
            output_index: this.outputIndex,
            item: {
              type: "function_call",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
        });
        this.outputIndex++;
      }
      this.pendingToolCalls.clear();

      const usage = chunk.usage;

      events.push({
        event: "response.completed",
        data: {
          response: {
            id: this.responseId,
            status: "completed",
            ...(usage
              ? {
                  usage: {
                    input_tokens: usage.prompt_tokens,
                    output_tokens: usage.completion_tokens,
                    total_tokens: usage.total_tokens,
                  },
                }
              : {}),
          },
        },
      });
    }

    return events;
  }
}

export function formatResponsesSSE(event: ResponsesSSEEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
