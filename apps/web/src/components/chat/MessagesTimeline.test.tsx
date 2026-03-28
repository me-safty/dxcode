import { MessageId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { deriveTimelineEntries } from "../../session-logic";

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    resolvedTheme: "light",
    setTheme: () => {},
  }),
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

async function renderTimeline(
  timelineEntries: ReturnType<typeof deriveTimelineEntries>,
  assistantResponseCopyFormat: "markdown" | "plain-text" = "markdown",
) {
  const { MessagesTimeline } = await import("./MessagesTimeline");
  return renderToStaticMarkup(
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={timelineEntries}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso="2026-03-17T19:12:30.000Z"
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="light"
      assistantResponseCopyFormat={assistantResponseCopyFormat}
      timestampFormat="locale"
      workspaceRoot={undefined}
    />,
  );
}

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const markup = await renderTimeline([
      {
        id: "entry-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:28.000Z",
        message: {
          id: MessageId.makeUnsafe("message-2"),
          role: "user",
          text: [
            "yoo what's @terminal-1:1-5 mean",
            "",
            "<terminal_context>",
            "- Terminal 1 lines 1-5:",
            "  1 | julius@mac effect-http-ws-cli % bun i",
            "  2 | bun install v1.3.9 (cf6cdbbb)",
            "</terminal_context>",
          ].join("\n"),
          createdAt: "2026-03-17T19:12:28.000Z",
          streaming: false,
        },
      },
    ]);

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  });

  it("renders context compaction entries in the normal work log", async () => {
    const markup = await renderTimeline([
      {
        id: "entry-1",
        kind: "work",
        createdAt: "2026-03-17T19:12:28.000Z",
        entry: {
          id: "work-1",
          createdAt: "2026-03-17T19:12:28.000Z",
          label: "Context compacted",
          tone: "info",
        },
      },
    ]);

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("renders a copy control for completed assistant messages", async () => {
    const markup = await renderTimeline([
      {
        id: "entry-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:28.000Z",
        message: {
          id: MessageId.makeUnsafe("assistant-complete"),
          role: "assistant",
          text: "Completed response",
          createdAt: "2026-03-17T19:12:28.000Z",
          completedAt: "2026-03-17T19:12:30.000Z",
          streaming: false,
        },
      },
    ]);

    expect(markup).toContain("Copy response");
  });

  it("does not render a copy control for streaming assistant messages", async () => {
    const markup = await renderTimeline([
      {
        id: "entry-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:28.000Z",
        message: {
          id: MessageId.makeUnsafe("assistant-streaming"),
          role: "assistant",
          text: "Partial response",
          createdAt: "2026-03-17T19:12:28.000Z",
          streaming: true,
        },
      },
    ]);

    expect(markup).not.toContain("Copy response");
  });

  it("does not render a copy control for empty completed assistant messages", async () => {
    const markup = await renderTimeline([
      {
        id: "entry-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:28.000Z",
        message: {
          id: MessageId.makeUnsafe("assistant-empty"),
          role: "assistant",
          text: "   ",
          createdAt: "2026-03-17T19:12:28.000Z",
          completedAt: "2026-03-17T19:12:30.000Z",
          streaming: false,
        },
      },
    ]);

    expect(markup).not.toContain("Copy response");
  });

  it("does not render a copy control when plain-text resolution is empty", async () => {
    const markup = await renderTimeline(
      [
        {
          id: "entry-1",
          kind: "message",
          createdAt: "2026-03-17T19:12:28.000Z",
          message: {
            id: MessageId.makeUnsafe("assistant-plain-text-empty"),
            role: "assistant",
            text: "---",
            createdAt: "2026-03-17T19:12:28.000Z",
            completedAt: "2026-03-17T19:12:30.000Z",
            streaming: false,
          },
        },
      ],
      "plain-text",
    );

    expect(markup).not.toContain("Copy response");
  });
});
