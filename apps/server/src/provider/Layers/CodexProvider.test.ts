import { describe, expect, it } from "vitest";

import { parseCodexSkillsListResponse } from "./CodexProvider.ts";

describe("parseCodexSkillsListResponse", () => {
  it("omits app-backed skills from Codex app-server results", () => {
    const skills = parseCodexSkillsListResponse(
      {
        data: [
          {
            cwd: "/workspace",
            errors: [],
            skills: [
              {
                name: "browser-use:browser",
                path: "/Users/test/.codex/plugins/cache/openai-bundled/browser-use/skills/browser/SKILL.md",
                description: "Drive a browser.",
                scope: "user",
                enabled: true,
              },
              {
                name: "review-follow-up",
                path: "/Users/test/.codex/skills/review-follow-up/SKILL.md",
                enabled: true,
                description: "Review a follow-up change.",
                scope: "user",
              },
              {
                name: "agent-plugin",
                path: "C:\\Users\\test\\.agents\\plugins\\cache\\example\\skills\\agent-plugin\\SKILL.md",
                description: "Run an app-backed agent skill.",
                scope: "user",
                enabled: true,
              },
            ],
          },
        ],
      },
      "/workspace",
    );

    expect(skills).toEqual([
      {
        name: "review-follow-up",
        path: "/Users/test/.codex/skills/review-follow-up/SKILL.md",
        enabled: true,
        description: "Review a follow-up change.",
        scope: "user",
      },
    ]);
  });
});
