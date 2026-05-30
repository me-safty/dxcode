import { describe, expect, it } from "vitest";
import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";

import {
  mapAntigravityTranscriptRecordToRuntimeEvents,
  parseAntigravityTranscriptLine,
} from "./AntigravityAdapter.ts";

describe("AntigravityAdapter transcript helpers", () => {
  it("parses valid transcript lines and ignores malformed lines", () => {
    expect(
      parseAntigravityTranscriptLine(
        '{"step_index":7,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE"}',
      ),
    ).toMatchObject({
      step_index: 7,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
    });

    expect(parseAntigravityTranscriptLine("not json")).toBeUndefined();
    expect(parseAntigravityTranscriptLine("   ")).toBeUndefined();
  });

  it("maps command transcript records to command lifecycle and output events", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      instanceId: ProviderInstanceId.make("antigravity"),
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-05-29T00:00:00.000Z",
      record: {
        step_index: 10,
        source: "MODEL",
        type: "RUN_COMMAND",
        status: "DONE",
        content: "47.0",
      },
    });

    expect(events.map((event) => event.type)).toEqual(["item.completed", "content.delta"]);
    expect(events[0]?.payload).toMatchObject({
      itemType: "command_execution",
      status: "completed",
      title: "Ran command",
    });
    expect(events[1]?.payload).toMatchObject({
      streamKind: "command_output",
      delta: "47.0",
    });
  });

  it("maps tool call records to dynamic tool lifecycle events", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      record: {
        step_index: 7,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          {
            name: "write_to_file",
            args: { TargetFile: '"/tmp/add_numbers.py"' },
          },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("item.completed");
    expect(events[0]?.payload).toMatchObject({
      itemType: "dynamic_tool_call",
      status: "completed",
      title: "write_to_file",
    });
  });

  it("does not render echoed user prompts or conversation history", () => {
    for (const record of [
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        content: "<USER_REQUEST>say hi</USER_REQUEST>",
      },
      {
        step_index: 1,
        source: "SYSTEM",
        type: "CONVERSATION_HISTORY",
        status: "DONE",
        content: "# Conversation History",
      },
    ]) {
      expect(
        mapAntigravityTranscriptRecordToRuntimeEvents({
          threadId: ThreadId.make("thread-1"),
          turnId: TurnId.make("turn-1"),
          record,
        }),
      ).toEqual([]);
    }
  });

  it("maps directory listings to tool items without assistant text", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      record: {
        step_index: 3,
        source: "MODEL",
        type: "LIST_DIRECTORY",
        status: "DONE",
        content: '{"name":"package.json"}',
      },
    });

    expect(events.map((event) => event.type)).toEqual(["item.completed"]);
    expect(events[0]?.payload).toMatchObject({
      itemType: "dynamic_tool_call",
      status: "completed",
      title: "Listed directory",
    });
  });

  it("emits assistant text and completes final response records", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      record: {
        step_index: 12,
        source: "MODEL",
        type: "FINAL_RESPONSE",
        status: "DONE",
        content: "Done.",
      },
    });

    expect(events.map((event) => event.type)).toEqual(["content.delta", "turn.completed"]);
    expect(events[0]?.payload).toMatchObject({
      streamKind: "assistant_text",
      delta: "Done.",
    });
  });

  it("maps system error transcript records to runtime failures", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      record: {
        step_index: 4,
        source: "SYSTEM",
        type: "ERROR_MESSAGE",
        status: "DONE",
        error: "usage limit has been exhausted",
      },
    });

    expect(events.map((event) => event.type)).toEqual(["runtime.error", "turn.completed"]);
    expect(events[0]?.payload).toMatchObject({
      message: "usage limit has been exhausted",
      class: "provider_error",
    });
    expect(events[1]?.payload).toMatchObject({
      state: "failed",
      errorMessage: "usage limit has been exhausted",
    });
  });

  it("treats terminal planner responses as assistant text", () => {
    const events = mapAntigravityTranscriptRecordToRuntimeEvents({
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      record: {
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "Adapter launch probe only.",
      },
    });

    expect(events.map((event) => event.type)).toEqual(["content.delta", "turn.completed"]);
    expect(events[0]?.payload).toMatchObject({
      streamKind: "assistant_text",
      delta: "Adapter launch probe only.",
    });
  });
});
