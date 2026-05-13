import { describe, expect, it } from "vitest";

import { stripSlackClientAttribution } from "./slackMessageText.ts";

describe("stripSlackClientAttribution", () => {
  it("removes Slack connector ChatGPT attribution lines", () => {
    expect(
      stripSlackClientAttribution(
        ["<@U0B0T56AY7R> please summarize this", "*Sent using* ChatGPT", ""].join("\n"),
      ),
    ).toBe("<@U0B0T56AY7R> please summarize this");
  });

  it("removes Slack italic ChatGPT attribution lines", () => {
    expect(
      stripSlackClientAttribution(
        ["<@U0B0T56AY7R> please summarize this", "_Sent using_ ChatGPT", ""].join("\n"),
      ),
    ).toBe("<@U0B0T56AY7R> please summarize this");
  });

  it("removes Slack connector ChatGPT attribution suffixes", () => {
    expect(
      stripSlackClientAttribution("<@U0B0T56AY7R> please summarize this. Sent using ChatGPT"),
    ).toBe("<@U0B0T56AY7R> please summarize this.");
  });

  it("does not remove normal user text mentioning ChatGPT", () => {
    expect(stripSlackClientAttribution("Please compare ChatGPT and Claude")).toBe(
      "Please compare ChatGPT and Claude",
    );
  });
});
