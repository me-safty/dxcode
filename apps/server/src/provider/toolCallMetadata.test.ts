import { describe, expect, it } from "vitest";

import { classifyToolItemType, summarizeToolRequest, titleForTool } from "./toolCallMetadata.ts";

describe("toolCallMetadata", () => {
  it("classifies task-style tool calls with subagent metadata as collaboration agents", () => {
    expect(classifyToolItemType("Task", { subagent_type: "code-reviewer" })).toBe(
      "collab_agent_tool_call",
    );
    expect(titleForTool("collab_agent_tool_call")).toBe("Subagent task");
  });

  it("summarizes command-style tool requests using the command text", () => {
    expect(summarizeToolRequest("Bash", { command: "git status" })).toBe("Bash: git status");
  });
});
