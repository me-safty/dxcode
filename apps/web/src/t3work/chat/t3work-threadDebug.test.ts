import { describe, expect, it } from "vite-plus/test";

import {
  appendT3WorkThreadDebugEvent,
  summarizeT3WorkServerThread,
  summarizeT3WorkThreadEvent,
  type T3WorkThreadDebugEvent,
} from "~/t3work/chat/t3work-threadDebug";

describe("appendT3WorkThreadDebugEvent", () => {
  it("keeps only the newest entries when the buffer exceeds its cap", () => {
    const events: T3WorkThreadDebugEvent[] = [
      { at: "2026-05-19T00:00:00.000Z", name: "one", payload: {} },
      { at: "2026-05-19T00:00:01.000Z", name: "two", payload: {} },
    ];

    const result = appendT3WorkThreadDebugEvent(
      events,
      { at: "2026-05-19T00:00:02.000Z", name: "three", payload: {} },
      2,
    );

    expect(result.map((event) => event.name)).toEqual(["two", "three"]);
  });
});

describe("summarizeT3WorkThreadEvent", () => {
  it("picks the most useful top-level fields from backend events", () => {
    expect(
      summarizeT3WorkThreadEvent({
        type: "thread.message.assistant.delta",
        threadId: "thread-1",
        turnId: "turn-1",
        status: "running",
        extra: "ignored",
      }),
    ).toEqual({
      type: "thread.message.assistant.delta",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "running",
    });
  });
});

describe("summarizeT3WorkServerThread", () => {
  it("extracts a compact summary from live thread state", () => {
    expect(
      summarizeT3WorkServerThread({
        id: "thread-1",
        projectId: "project-1",
        title: "My thread",
        messages: [{}, {}],
        latestTurn: { turnId: "turn-1" },
        session: { status: "running" },
        archivedAt: null,
        error: null,
      }),
    ).toEqual({
      id: "thread-1",
      projectId: "project-1",
      title: "My thread",
      messageCount: 2,
      latestTurnId: "turn-1",
      sessionStatus: "running",
      archivedAt: null,
      error: null,
    });
  });
});
