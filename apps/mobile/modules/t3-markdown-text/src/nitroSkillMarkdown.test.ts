import { describe, expect, it } from "vite-plus/test";

import { decorateNitroMarkdownWithSkills } from "./nitroSkillMarkdown.ts";

describe("decorateNitroMarkdownWithSkills", () => {
  it("wraps known skill tokens in t3-skill links", () => {
    const markdown = "Use $ui for layout and $docs for copy.";
    const decorated = decorateNitroMarkdownWithSkills(markdown, [
      { name: "ui", displayName: "UI" },
      { name: "docs" },
    ]);

    expect(decorated).toBe("Use [UI](t3-skill:ui) for layout and [Docs](t3-skill:docs) for copy.");
  });

  it("leaves unknown skill-like tokens unchanged", () => {
    const markdown = "Try $unknown next.";
    expect(decorateNitroMarkdownWithSkills(markdown, [{ name: "ui" }])).toBe(markdown);
  });
});
