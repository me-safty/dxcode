import { describe, expect, it } from "vitest";

import {
  translateResponsesToChatCompletions,
  UnsupportedResponsesFeatureError,
  type ResponsesRequest,
} from "./translateResponsesToGlm.ts";

describe("translateResponsesToChatCompletions", () => {
  it("translates a simple text-only request", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "Hello" }],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.model).toBe("glm-5.1");
    expect(result.stream).toBe(true);
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("prepends system instructions as a system message", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "Write code" }],
      instructions: "You are a coding assistant.",
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a coding assistant.",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "Write code" });
  });

  it("translates a multi-turn conversation", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.messages).toEqual([
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ]);
  });

  it("translates function tools", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "List files" }],
      tools: [
        {
          type: "function",
          name: "list_files",
          description: "List files in a directory",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "list_files",
          description: "List files in a directory",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ]);
  });

  it("translates tool_choice as a string", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      tool_choice: "auto",
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.tool_choice).toBe("auto");
  });

  it("translates tool_choice as a named function", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      tool_choice: { type: "function", name: "read_file" },
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.tool_choice).toEqual({
      type: "function",
      function: { name: "read_file" },
    });
  });

  it("translates function_call_output items to tool role messages", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            {
              type: "function_call",
              id: "call_123",
              name: "list_files",
              arguments: '{"path":"."}',
            },
          ],
        },
        { type: "function_call_output", call_id: "call_123", output: "file1.ts\nfile2.ts" },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: { name: "list_files", arguments: '{"path":"."}' },
        },
      ],
    });
    expect(result.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "file1.ts\nfile2.ts",
    });
  });

  it("extracts text from input_text content parts", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "part one " },
            { type: "input_text", text: "part two" },
          ],
        },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.messages[0]).toEqual({ role: "user", content: "part one part two" });
  });

  it("combines assistant text and tool calls from content parts", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [
        {
          role: "assistant",
          content: [
            { type: "output_text", text: "I'll read the file." },
            {
              type: "function_call",
              id: "call_abc",
              name: "read_file",
              arguments: '{"path":"main.ts"}',
            },
          ],
        },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "I'll read the file.",
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"main.ts"}' },
        },
      ],
    });
  });

  it("forwards temperature and max_output_tokens", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      temperature: 0.7,
      max_output_tokens: 4096,
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(4096);
  });

  it("omits optional fields when not provided", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.tools).toBeUndefined();
    expect(result.tool_choice).toBeUndefined();
    expect(result.temperature).toBeUndefined();
    expect(result.max_tokens).toBeUndefined();
  });

  it("defaults stream to true when not specified", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.stream).toBe(true);
  });

  it("includes stream_options with include_usage", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it("preserves tool strict mode when present", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          name: "exec",
          strict: true,
          parameters: { type: "object" },
        },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.tools![0]!.function.strict).toBe(true);
  });

  it("handles inline system messages in the input array", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      stream: true,
    };

    const result = translateResponsesToChatCompletions(req);
    expect(result.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hello" },
    ]);
  });

  it("throws UnsupportedResponsesFeatureError for non-function tool types", () => {
    const req: ResponsesRequest = {
      model: "glm-5.1",
      input: [{ role: "user", content: "test" }],
      tools: [{ type: "web_search" as any, name: "search" }],
      stream: true,
    };

    expect(() => translateResponsesToChatCompletions(req)).toThrow(
      UnsupportedResponsesFeatureError,
    );
  });
});
