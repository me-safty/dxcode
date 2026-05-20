import { describe, expect, it } from "vitest";

import type { TaskIntakeMessage } from "./contracts.ts";
import { buildTaskIntakeFollowUpPrompt, buildTaskIntakeInitialPrompt } from "./prompts.ts";

const message: TaskIntakeMessage = {
  eventId: "slack:event-1",
  source: "slack",
  conversation: {
    source: "slack",
    externalLinkKind: "slack_thread",
    externalId: "T1:C1:1712923200.000100",
    teamId: "T1",
    channelId: "C1",
  },
  messageId: "1712923210.000200",
  text: "  <@BOT> fix checkout  ",
  attachments: [
    {
      name: "error-log.txt",
      url: "https://files.slack.com/files-pri/T1-F1/error-log.txt",
    },
    {
      url: "https://files.slack.com/files-pri/T1-F2/screenshot.png",
    },
  ],
  receivedAt: "2026-04-12T12:00:00.000Z",
};

describe("Task Intake prompts", () => {
  it("wraps the shared operating rules before the source message body", () => {
    const prompt = buildTaskIntakeInitialPrompt(message);

    expect(prompt).toContain("<agent_prompt>");
    expect(prompt).toContain("System context and operating rules:");
    expect(prompt).toContain("commit them and push the branch");
    expect(prompt).toContain("pull request targeting `dev`");
    expect(prompt).toContain("</agent_prompt>\n\nUser request:\n<@BOT> fix checkout");
    expect(prompt).toContain(
      "error-log.txt: https://files.slack.com/files-pri/T1-F1/error-log.txt",
    );
    expect(prompt).toContain(
      "Attachment 2: https://files.slack.com/files-pri/T1-F2/screenshot.png",
    );
  });

  it("wraps normal prepended context as the agent prompt before the user request", () => {
    const prompt = buildTaskIntakeInitialPrompt(message, { agentPrompt: "thread context" });

    expect(prompt).toContain("<agent_prompt>");
    expect(prompt).toContain("System context and operating rules:");
    expect(prompt).toContain("thread context");
    expect(prompt).toContain("</agent_prompt>\n\nUser request:\n<@BOT> fix checkout");
  });

  it("wraps support triage context separately from normal agent context", () => {
    const prompt = buildTaskIntakeInitialPrompt(message, {
      triagePrompt: "support triage rules",
      agentPrompt: "thread context",
    });

    expect(prompt).toContain("<triage_prompt>\nsupport triage rules\n</triage_prompt>");
    expect(prompt).toContain("<agent_prompt>");
    expect(prompt).toContain("System context and operating rules:");
    expect(prompt).toContain("thread context");
    expect(prompt).toContain("</agent_prompt>\n\nUser request:\n<@BOT> fix checkout");
  });

  it("uses the same plain relay format for follow-ups", () => {
    expect(buildTaskIntakeFollowUpPrompt(message)).not.toContain("Source:");
    expect(buildTaskIntakeFollowUpPrompt(message)).not.toContain("Follow-up message:");
    expect(buildTaskIntakeFollowUpPrompt(message)).toContain("<@BOT> fix checkout");
  });
});
