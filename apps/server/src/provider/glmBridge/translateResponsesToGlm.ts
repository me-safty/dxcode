export interface ResponsesRequest {
  model: string;
  input: ResponsesInput[];
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: string | { type: string; name?: string };
  parallel_tool_calls?: boolean;
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: { effort?: string };
}

export type ResponsesInput =
  | { role: "user"; content: string | ResponsesContentPart[] }
  | { role: "assistant"; content: string | ResponsesContentPart[] }
  | { role: "system"; content: string }
  | ResponsesFunctionCallOutput;

interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "function_call"; id: string; name: string; arguments: string }
  | { type: "text"; text: string };

interface ResponsesTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  stream_options?: { include_usage: boolean };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string | undefined;
    parameters?: Record<string, unknown> | undefined;
    strict?: boolean | undefined;
  };
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export class UnsupportedResponsesFeatureError extends Error {
  constructor(feature: string) {
    super(`Unsupported Responses API feature for GLM bridge: ${feature}`);
    this.name = "UnsupportedResponsesFeatureError";
  }
}

export function translateResponsesToChatCompletions(req: ResponsesRequest): ChatCompletionsRequest {
  const messages: ChatMessage[] = [];

  if (req.instructions) {
    messages.push({ role: "system", content: req.instructions });
  }

  for (const item of req.input) {
    if ("type" in item && item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output,
      });
      continue;
    }

    const msg = item as Exclude<ResponsesInput, ResponsesFunctionCallOutput>;

    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content as string });
      continue;
    }

    if (msg.role === "user") {
      const content = extractTextContent(msg.content);
      messages.push({ role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const textParts: string[] = [];
      const toolCalls: ChatToolCall[] = [];

      if (typeof msg.content === "string") {
        textParts.push(msg.content);
      } else {
        for (const part of parts) {
          if (part.type === "output_text" || part.type === "text") {
            textParts.push(part.text);
          } else if (part.type === "function_call") {
            toolCalls.push({
              id: part.id,
              type: "function",
              function: { name: part.name, arguments: part.arguments },
            });
          }
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("") : null,
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      messages.push(assistantMsg);
      continue;
    }
  }

  const tools: ChatTool[] | undefined = req.tools?.map((tool): ChatTool => {
    if (tool.type !== "function") {
      throw new UnsupportedResponsesFeatureError(`tool type "${tool.type}"`);
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      },
    };
  });

  let toolChoice: ChatCompletionsRequest["tool_choice"];
  if (req.tool_choice !== undefined) {
    if (typeof req.tool_choice === "string") {
      toolChoice = req.tool_choice;
    } else if (req.tool_choice.type === "function" && req.tool_choice.name) {
      toolChoice = {
        type: "function",
        function: { name: req.tool_choice.name },
      };
    }
  }

  return {
    model: req.model,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    stream: req.stream !== false,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.max_output_tokens !== undefined ? { max_tokens: req.max_output_tokens } : {}),
    stream_options: { include_usage: true },
  };
}

function extractTextContent(content: string | ResponsesContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (p): p is { type: "input_text" | "text"; text: string } =>
        p.type === "input_text" || p.type === "text",
    )
    .map((p) => p.text)
    .join("");
}
