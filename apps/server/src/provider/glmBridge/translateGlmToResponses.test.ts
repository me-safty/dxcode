import { describe, expect, it } from "vitest";

import {
  GlmToResponsesTranslator,
  formatResponsesSSE,
  type ChatCompletionsChunk,
} from "./translateGlmToResponses.ts";

function makeChunk(overrides: Partial<ChatCompletionsChunk> = {}): ChatCompletionsChunk {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    model: "glm-5.1",
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    ...overrides,
  };
}

describe("GlmToResponsesTranslator", () => {
  it("emits output_item.added on the first text delta", () => {
    const translator = new GlmToResponsesTranslator("resp_1");
    const chunk = makeChunk({
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    });

    const events = translator.translateChunk(chunk);

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe("response.output_item.added");
    expect(events[1]!.event).toBe("response.output_text.delta");
    expect(events[1]!.data.delta).toBe("Hello");
  });

  it("does not emit output_item.added on subsequent text deltas", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("response.output_text.delta");
    expect(events[0]!.data.delta).toBe(" world");
  });

  it("emits completion events on finish_reason", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual([
      "response.output_text.done",
      "response.output_item.done",
      "response.completed",
    ]);
  });

  it("includes usage in response.completed when available", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const completed = events.find((e) => e.event === "response.completed");
    expect(completed).toBeDefined();
    const response = completed!.data.response as Record<string, unknown>;
    expect(response.status).toBe("completed");
    const usage = response.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(10);
    expect(usage.output_tokens).toBe(5);
    expect(usage.total_tokens).toBe(15);
  });

  it("accumulates tool call deltas and flushes on finish", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "read_file", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"main.ts"}' } }],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    const addedEvent = events.find((e) => e.event === "response.output_item.added");
    expect(addedEvent).toBeDefined();
    const item = addedEvent!.data.item as Record<string, unknown>;
    expect(item.type).toBe("function_call");
    expect(item.name).toBe("read_file");
    expect(item.arguments).toBe('{"path":"main.ts"}');
    expect(item.id).toBe("call_abc");

    const doneEvent = events.find((e) => e.event === "response.output_item.done");
    expect(doneEvent).toBeDefined();

    const completedEvent = events.find((e) => e.event === "response.completed");
    expect(completedEvent).toBeDefined();
  });

  it("handles text followed by tool calls", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { content: "I'll read the file." }, finish_reason: null }],
      }),
    );

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"a.ts"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("response.output_text.done");
    expect(eventTypes).toContain("response.output_item.done");
    expect(eventTypes).toContain("response.output_item.added");
    expect(eventTypes).toContain("response.completed");
  });

  it("handles multiple parallel tool calls", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"a.ts"}' },
                },
                {
                  index: 1,
                  id: "call_2",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"b.ts"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    const addedEvents = events.filter((e) => e.event === "response.output_item.added");
    expect(addedEvents).toHaveLength(2);

    const names = addedEvents.map((e) => (e.data.item as Record<string, unknown>).name);
    expect(names).toContain("read_file");
  });

  it("returns empty array for chunks with no content or tool calls", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      }),
    );

    expect(events).toHaveLength(0);
  });

  it("returns empty array when choices is empty", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    const events = translator.translateChunk(makeChunk({ choices: [] }));

    expect(events).toHaveLength(0);
  });

  it("emits response.completed without text events when no text was streamed", () => {
    const translator = new GlmToResponsesTranslator("resp_1");

    translator.translateChunk(
      makeChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "exec", arguments: '{"cmd":"ls"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );

    const events = translator.translateChunk(
      makeChunk({
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).not.toContain("response.output_text.done");
    expect(eventTypes).toContain("response.output_item.added");
    expect(eventTypes).toContain("response.output_item.done");
    expect(eventTypes).toContain("response.completed");
  });
});

describe("formatResponsesSSE", () => {
  it("formats an event as SSE wire format", () => {
    const result = formatResponsesSSE({
      event: "response.output_text.delta",
      data: { delta: "Hello" },
    });

    expect(result).toBe('event: response.output_text.delta\ndata: {"delta":"Hello"}\n\n');
  });
});
