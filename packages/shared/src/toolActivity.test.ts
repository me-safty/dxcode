import { describe, expect, it } from "vitest";

import { classifyToolLifecycleItemType, deriveToolActivityPresentation } from "./toolActivity.ts";

describe("classifyToolLifecycleItemType", () => {
  it("routes mcp__ tools to mcp_tool_call", () => {
    expect(classifyToolLifecycleItemType({ toolName: "mcp__github__create_issue" })).toBe(
      "mcp_tool_call",
    );
    expect(classifyToolLifecycleItemType({ toolName: "mcp_github_create_issue" })).toBe(
      "mcp_tool_call",
    );
  });

  it("classifies bash/terminal/run-command tools as command_execution", () => {
    expect(classifyToolLifecycleItemType({ toolName: "bash" })).toBe("command_execution");
    expect(classifyToolLifecycleItemType({ toolName: "run_terminal_cmd" })).toBe(
      "command_execution",
    );
    expect(classifyToolLifecycleItemType({ toolName: "execute_command" })).toBe(
      "command_execution",
    );
  });

  it("classifies read/view/cat tools as file_read", () => {
    expect(classifyToolLifecycleItemType({ toolName: "read_file" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "view_file" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "cat" })).toBe("file_read");
  });

  it("classifies ls/glob/grep/codebase_search as exploration (file_read)", () => {
    expect(classifyToolLifecycleItemType({ toolName: "ls" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "list_directory" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "glob" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "grep" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "codebase_search" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ toolName: "file_search" })).toBe("file_read");
  });

  it("classifies edit/write/patch/multiedit as file_change", () => {
    expect(classifyToolLifecycleItemType({ toolName: "edit_file" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ toolName: "write" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ toolName: "multi_edit" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ toolName: "str_replace" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ toolName: "apply_patch" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ toolName: "delete_file" })).toBe("file_change");
  });

  it("distinguishes web_fetch from web_search", () => {
    expect(classifyToolLifecycleItemType({ toolName: "web_fetch" })).toBe("web_fetch");
    expect(classifyToolLifecycleItemType({ toolName: "webfetch" })).toBe("web_fetch");
    expect(classifyToolLifecycleItemType({ toolName: "fetch_url" })).toBe("web_fetch");
    expect(classifyToolLifecycleItemType({ toolName: "web_search" })).toBe("web_search");
    expect(classifyToolLifecycleItemType({ toolName: "websearch" })).toBe("web_search");
  });

  it("classifies subagent/task tools as collab_agent_tool_call", () => {
    expect(classifyToolLifecycleItemType({ toolName: "task" })).toBe("collab_agent_tool_call");
    expect(classifyToolLifecycleItemType({ toolName: "subagent" })).toBe("collab_agent_tool_call");
  });

  it("classifies image view as image_view", () => {
    expect(classifyToolLifecycleItemType({ toolName: "view_image" })).toBe("image_view");
    expect(classifyToolLifecycleItemType({ toolName: "image_view" })).toBe("image_view");
  });

  it("maps ACP kinds correctly (execute → command_execution, read → file_read, fetch → web_fetch)", () => {
    expect(classifyToolLifecycleItemType({ kind: "execute" })).toBe("command_execution");
    expect(classifyToolLifecycleItemType({ kind: "read" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ kind: "edit" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ kind: "delete" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ kind: "move" })).toBe("file_change");
    expect(classifyToolLifecycleItemType({ kind: "search" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ kind: "fetch" })).toBe("web_fetch");
  });

  it("falls back to title when no kind/toolName match", () => {
    expect(classifyToolLifecycleItemType({ title: "Read file" })).toBe("file_read");
    expect(classifyToolLifecycleItemType({ title: "Bash" })).toBe("command_execution");
    expect(classifyToolLifecycleItemType({ title: "Grep" })).toBe("file_read");
  });

  it("returns dynamic_tool_call for unknown inputs", () => {
    expect(classifyToolLifecycleItemType({ toolName: "proprietary_gadget" })).toBe(
      "dynamic_tool_call",
    );
    expect(classifyToolLifecycleItemType({ kind: "other" })).toBe("dynamic_tool_call");
    expect(classifyToolLifecycleItemType({})).toBe("dynamic_tool_call");
  });

  it("prioritizes toolName over kind when both are provided", () => {
    expect(classifyToolLifecycleItemType({ toolName: "bash", kind: "read" })).toBe(
      "command_execution",
    );
  });
});

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });
});
