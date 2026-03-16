import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ProviderRuntimeEvent } from "./providerRuntime";

const decodeRuntimeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);

describe("ProviderRuntimeEvent", () => {
  it("decodes turn.plan.updated for plan rendering", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.plan.updated",
      eventId: "event-1",
      provider: "codex",
      sessionId: "runtime-session-1",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        explanation: "Implement schema updates",
        plan: [
          { step: "Define event union", status: "completed" },
          { step: "Wire adapter mapping", status: "inProgress" },
        ],
      },
    });

    expect(parsed.type).toBe("turn.plan.updated");
    if (parsed.type !== "turn.plan.updated") {
      throw new Error("expected turn.plan.updated");
    }
    expect(parsed.payload.plan).toHaveLength(2);
    expect(parsed.payload.plan[1]?.status).toBe("inProgress");
  });

  it("decodes proposed-plan completion events", () => {
    const parsed = decodeRuntimeEvent({
      type: "turn.proposed.completed",
      eventId: "event-proposed-plan-1",
      provider: "codex",
      createdAt: "2026-02-28T00:00:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        planMarkdown: "# Ship it",
      },
    });

    expect(parsed.type).toBe("turn.proposed.completed");
    if (parsed.type !== "turn.proposed.completed") {
      throw new Error("expected turn.proposed.completed");
    }
    expect(parsed.payload.planMarkdown).toBe("# Ship it");
  });

  it("decodes user-input.requested with structured questions", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.requested",
      eventId: "event-2",
      provider: "codex",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:01.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow edits in workspace only",
              },
              {
                label: "danger-full-access",
                description: "Allow unrestricted access",
              },
            ],
          },
        ],
      },
    });

    expect(parsed.type).toBe("user-input.requested");
    if (parsed.type !== "user-input.requested") {
      throw new Error("expected user-input.requested");
    }
    expect(parsed.payload.questions[0]?.id).toBe("sandbox_mode");
    expect(parsed.payload.questions[0]?.options).toHaveLength(2);
  });

  it("decodes user-input.resolved with answer map", () => {
    const parsed = decodeRuntimeEvent({
      type: "user-input.resolved",
      eventId: "event-3",
      provider: "codex",
      sessionId: "runtime-session-2",
      createdAt: "2026-02-28T00:00:02.000Z",
      threadId: "thread-2",
      requestId: "request-1",
      payload: {
        answers: {
          sandbox_mode: "workspace-write",
        },
      },
    });

    expect(parsed.type).toBe("user-input.resolved");
    if (parsed.type !== "user-input.resolved") {
      throw new Error("expected user-input.resolved");
    }
    expect(parsed.payload.answers.sandbox_mode).toBe("workspace-write");
  });

  it("decodes task and hook metadata for Claude agent teams", () => {
    const taskEvent = decodeRuntimeEvent({
      type: "task.progress",
      eventId: "event-task-progress-1",
      provider: "claudeCode",
      createdAt: "2026-02-28T00:00:02.000Z",
      threadId: "thread-2",
      turnId: "turn-2",
      payload: {
        taskId: "task-1",
        description: "Reviewing migration plan",
        summary: "DB reviewer is checking rollback paths.",
        agentId: "agent-db-reviewer",
        agentName: "db-reviewer",
        agentColor: "purple",
        toolUseId: "tool-task-1",
        teammateName: "db-reviewer",
        teamName: "release-squad",
        agentType: "code-reviewer",
        parentSessionId: "session-lead-1",
        teammateMode: "in-process",
        planModeRequired: true,
      },
    });

    expect(taskEvent.type).toBe("task.progress");
    if (taskEvent.type !== "task.progress") {
      throw new Error("expected task.progress");
    }
    expect(taskEvent.payload.toolUseId).toBe("tool-task-1");
    expect(taskEvent.payload.agentId).toBe("agent-db-reviewer");
    expect(taskEvent.payload.agentName).toBe("db-reviewer");
    expect(taskEvent.payload.agentColor).toBe("purple");
    expect(taskEvent.payload.teammateName).toBe("db-reviewer");
    expect(taskEvent.payload.teamName).toBe("release-squad");
    expect(taskEvent.payload.parentSessionId).toBe("session-lead-1");
    expect(taskEvent.payload.teammateMode).toBe("in-process");
    expect(taskEvent.payload.planModeRequired).toBe(true);

    const hookEvent = decodeRuntimeEvent({
      type: "hook.started",
      eventId: "event-hook-started-1",
      provider: "claudeCode",
      createdAt: "2026-02-28T00:00:03.000Z",
      threadId: "thread-2",
      payload: {
        hookId: "hook-1",
        hookName: "Team idle notifier",
        hookEvent: "TeammateIdle",
        agentId: "agent-db-reviewer",
        agentName: "db-reviewer",
        teamName: "release-squad",
        teammateName: "db-reviewer",
      },
    });

    expect(hookEvent.type).toBe("hook.started");
    if (hookEvent.type !== "hook.started") {
      throw new Error("expected hook.started");
    }
    expect(hookEvent.payload.hookEvent).toBe("TeammateIdle");
    expect(hookEvent.payload.agentId).toBe("agent-db-reviewer");
    expect(hookEvent.payload.agentName).toBe("db-reviewer");
    expect(hookEvent.payload.teamName).toBe("release-squad");
    expect(hookEvent.payload.teammateName).toBe("db-reviewer");
  });

  it("rejects legacy message.delta type", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "message.delta",
        eventId: "event-4",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        payload: { delta: "legacy" },
      }),
    ).toThrow();
  });

  it("rejects empty branded canonical ids", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "runtime.error",
        eventId: "event-5",
        provider: "codex",
        sessionId: "runtime-session-3",
        createdAt: "2026-02-28T00:00:03.000Z",
        threadId: "   ",
        payload: { message: "boom" },
      }),
    ).toThrow();
  });
});
