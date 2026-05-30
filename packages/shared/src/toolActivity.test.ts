import { describe, expect, it } from "vitest";

import { deriveToolActivityPresentation } from "./toolActivity.ts";

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

  it("uses in-progress phrasing for started command tools", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        status: "inProgress",
        lifecycle: "started",
        detail: "bun run lint",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Tool started",
      }),
    ).toEqual({
      summary: "Running command",
      detail: "bun run lint",
    });
  });

  it("uses in-progress phrasing for active web searches", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        lifecycle: "started",
        data: {
          item: {
            action: {
              type: "search",
              query: "codex app server docs",
            },
          },
        },
        fallbackSummary: "Tool started",
      }),
    ).toEqual({
      summary: "Searching web",
      detail: "codex app server docs",
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

  it("uses structured web search metadata for the detail", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "Web search",
        detail: "Web search",
        data: {
          item: {
            action: {
              type: "openPage",
              url: "https://developers.openai.com/codex/sdk/",
            },
            query: "fallback query",
          },
        },
        fallbackSummary: "Web search",
      }),
    ).toEqual({
      summary: "Searched web",
      detail: "https://developers.openai.com/codex/sdk/",
    });
  });

  it("uses web search action query metadata for the detail", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "Web search",
        detail: "Web search",
        data: {
          item: {
            action: {
              type: "search",
              query: "codex app server docs",
            },
          },
        },
        fallbackSummary: "Web search",
      }),
    ).toEqual({
      summary: "Searched web",
      detail: "codex app server docs",
    });
  });

  it("keeps file-search tool summaries distinct from web searches", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "grep",
        detail: "grep",
        data: {
          kind: "search",
          rawInput: {
            pattern: "deriveToolActivityPresentation",
          },
        },
        fallbackSummary: "grep",
      }),
    ).toEqual({
      summary: "Searched files",
      detail: "deriveToolActivityPresentation",
    });
  });

  it("keeps lifecycle status in summaries for custom tools", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        status: "failed",
        title: "My Tool",
        detail: "Failed with exit code 1",
        fallbackSummary: "Tool",
      }),
    ).toEqual({
      summary: "My Tool failed",
      detail: "Failed with exit code 1",
    });

    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        status: "declined",
        title: "My Tool",
        fallbackSummary: "Tool",
      }),
    ).toEqual({
      summary: "My Tool declined",
    });
  });
});
