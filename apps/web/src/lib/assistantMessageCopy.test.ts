import { describe, expect, it } from "vitest";

import { markdownToPlainText, resolveAssistantMessageCopyText } from "./assistantMessageCopy";

describe("assistantMessageCopy", () => {
  it("returns the raw assistant markdown unchanged in markdown mode", () => {
    const markdown = ["# Heading", "", "- item", "", "```ts", "console.log('hi');", "```"].join(
      "\n",
    );

    expect(resolveAssistantMessageCopyText(markdown, "markdown")).toBe(markdown);
  });

  it("serializes markdown into stable plain text", () => {
    const markdown = [
      "# Heading",
      "",
      "Paragraph with [docs](https://example.com/docs) and [](https://example.com/fallback).",
      "",
      "> Quoted **text**",
      "",
      "- first item",
      "- second item",
      "",
      "1. ordered",
      "2. next",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| One | 1 |",
      "",
      "```ts",
      "const value = 1;",
      "console.log(value);",
      "```",
    ].join("\n");

    expect(markdownToPlainText(markdown)).toBe(
      [
        "Heading",
        "",
        "Paragraph with docs and https://example.com/fallback.",
        "",
        "Quoted text",
        "",
        "- first item",
        "- second item",
        "",
        "1. ordered",
        "2. next",
        "",
        "Name | Value",
        "One | 1",
        "",
        "const value = 1;",
        "console.log(value);",
      ].join("\n"),
    );
  });
});
