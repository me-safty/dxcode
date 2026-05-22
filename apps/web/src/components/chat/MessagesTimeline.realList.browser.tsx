import "../../index.css";

import {
  EnvironmentId,
  MessageId,
  type EnvironmentId as EnvironmentIdType,
} from "@t3tools/contracts";
import { createRef, forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { VirtualizedListHandle } from "../virtualization/VirtualizedList";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { TimelineEntry } from "../../session-logic";
import { MessagesTimeline } from "./MessagesTimeline";
import {
  captureTimelinePrependScrollSnapshot,
  captureTimelineScrollAnchor,
  restoreTimelinePrependScrollSnapshot,
  type TimelineScrollAnchor,
} from "./timelineScrollAnchor";

const ACTIVE_THREAD_ENVIRONMENT_ID: EnvironmentIdType = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT_MS = Date.parse("2026-05-19T12:00:00.000Z");
const TIMELINE_ROW_COUNT = 44;

interface ScrollSnapshot {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly maxScrollTop: number;
  readonly firstRenderedRowId: string | null;
  readonly lastRenderedRowId: string | null;
}

interface TimelineHarnessHandle {
  readonly appendMessage: () => void;
  readonly prependMessages: () => void;
  readonly mergeTailSnapshot: () => void;
  readonly anchorTop: (messageId: string) => number | null;
  readonly anchorElementTop: (anchorId: string) => number | null;
  readonly captureAnchor: () => TimelineScrollAnchor | null;
  readonly scrollToEnd: () => Promise<void>;
  readonly scrollToOffset: (offset: number) => Promise<void>;
  readonly scrollIndexIntoView: (index: number) => Promise<void>;
  readonly snapshot: () => ScrollSnapshot;
}

function buildMessageText(role: "assistant" | "user", index: number): string {
  return `${role} message ${index}\n${"body ".repeat(60).trim()}`;
}

function buildTimelineEntry(index: number): Extract<TimelineEntry, { kind: "message" }> {
  const role = index % 2 === 0 ? "user" : "assistant";
  const createdAt = new Date(MESSAGE_CREATED_AT_MS + index * 1_000).toISOString();
  const messageId = MessageId.make(`message-${index}`);
  return {
    id: messageId,
    kind: "message",
    createdAt,
    message: {
      id: messageId,
      role,
      text: buildMessageText(role, index),
      createdAt,
      streaming: false,
    },
  };
}

function buildTimelineEntries(count: number): TimelineEntry[] {
  return Array.from({ length: count }, (_, index) => buildTimelineEntry(index));
}

function getScrollSnapshot(listRef: VirtualizedListHandle | null): ScrollSnapshot {
  const scrollableNode = listRef?.getScrollableNode?.();
  if (!scrollableNode) {
    throw new Error("Unable to resolve MessagesTimeline scroll node.");
  }
  const renderedRows = Array.from(document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"));
  return {
    scrollTop: scrollableNode.scrollTop,
    scrollHeight: scrollableNode.scrollHeight,
    clientHeight: scrollableNode.clientHeight,
    maxScrollTop: Math.max(0, scrollableNode.scrollHeight - scrollableNode.clientHeight),
    firstRenderedRowId: renderedRows[0]?.dataset.timelineRowId ?? null,
    lastRenderedRowId: renderedRows.at(-1)?.dataset.timelineRowId ?? null,
  };
}

function distanceFromBottom(snapshot: ScrollSnapshot): number {
  return snapshot.maxScrollTop - snapshot.scrollTop;
}

async function waitForLayout(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

const TimelineHarness = forwardRef<TimelineHarnessHandle>(function TimelineHarness(_, ref) {
  const [timelineEntries, setTimelineEntries] = useState(() =>
    buildTimelineEntries(TIMELINE_ROW_COUNT),
  );
  const listRef = useRef<VirtualizedListHandle | null>(null);
  const emptyTurnDiffSummary = useMemo(() => new Map(), []);
  const emptyRevertTurnCount = useMemo(() => new Map(), []);

  useImperativeHandle(
    ref,
    () => ({
      appendMessage: () => {
        setTimelineEntries((current) => [...current, buildTimelineEntry(current.length)]);
      },
      prependMessages: () => {
        const snapshot = captureTimelinePrependScrollSnapshot(listRef.current);
        flushSync(() => {
          setTimelineEntries((current) => [
            ...Array.from({ length: 18 }, (_, index) => buildTimelineEntry(index - 18)),
            ...current,
          ]);
        });
        if (snapshot) {
          restoreTimelinePrependScrollSnapshot(listRef.current, snapshot);
        }
      },
      mergeTailSnapshot: () => {
        setTimelineEntries((current) => {
          const repairedEntry = buildTimelineEntry(TIMELINE_ROW_COUNT - 1);
          const incomingTail = [
            {
              ...repairedEntry,
              message: {
                ...repairedEntry.message,
                text: `${repairedEntry.message.text}\nrepaired tail text`,
              },
            },
            buildTimelineEntry(TIMELINE_ROW_COUNT),
          ];
          const byId = new Map(current.map((entry) => [entry.id, entry] as const));
          for (const entry of incomingTail) {
            byId.set(entry.id, entry);
          }
          return [...byId.values()].toSorted((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
          );
        });
      },
      anchorTop: (messageId: string) => {
        const anchor = document.querySelector<HTMLElement>(
          `[data-timeline-anchor-id="message:${messageId}"]`,
        );
        return anchor?.getBoundingClientRect().top ?? null;
      },
      anchorElementTop: (anchorId: string) => {
        const anchor = document.querySelector<HTMLElement>(
          `[data-timeline-anchor-id="${anchorId}"]`,
        );
        return anchor?.getBoundingClientRect().top ?? null;
      },
      captureAnchor: () => captureTimelineScrollAnchor(listRef.current),
      scrollToEnd: async () => {
        await listRef.current?.scrollToEnd?.({ animated: false });
      },
      scrollToOffset: async (offset: number) => {
        await listRef.current?.scrollToOffset?.({ offset, animated: false });
      },
      scrollIndexIntoView: async (index: number) => {
        await listRef.current?.scrollIndexIntoView?.({ index, animated: false });
      },
      snapshot: () => getScrollSnapshot(listRef.current),
    }),
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "720px", width: "900px" }}>
      <MessagesTimeline
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnId={null}
        activeTurnStartedAt={null}
        listRef={listRef}
        timelineEntries={timelineEntries}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={emptyTurnDiffSummary}
        routeThreadKey="environment-local:thread-real-list"
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={emptyRevertTurnCount}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="24-hour"
        workspaceRoot={undefined}
        skills={[]}
        onIsAtEndChange={() => {}}
      />
    </div>
  );
});

function TimelineFixture({
  timelineEntries,
  width,
}: {
  timelineEntries: TimelineEntry[];
  width: number;
}) {
  const listRef = useRef<VirtualizedListHandle | null>(null);
  const emptyTurnDiffSummary = useMemo(() => new Map(), []);
  const emptyRevertTurnCount = useMemo(() => new Map(), []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "720px",
        overflow: "hidden",
        width: `${width}px`,
      }}
    >
      <MessagesTimeline
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnId={null}
        activeTurnStartedAt={null}
        listRef={listRef}
        timelineEntries={timelineEntries}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={emptyTurnDiffSummary}
        routeThreadKey="environment-local:thread-overflow"
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={emptyRevertTurnCount}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd="/repo"
        resolvedTheme="dark"
        timestampFormat="24-hour"
        workspaceRoot="/repo"
        skills={[]}
        onIsAtEndChange={() => {}}
      />
    </div>
  );
}

describe("MessagesTimeline real virtualized timeline scrolling", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the timeline pinned to the bottom when a row is appended", async () => {
    await page.viewport(1_000, 760);
    const harnessRef = createRef<TimelineHarnessHandle>();
    const screen = await render(<TimelineHarness ref={harnessRef} />);

    try {
      await waitForLayout();
      await harnessRef.current?.scrollToEnd();

      await expect.poll(() => distanceFromBottom(harnessRef.current!.snapshot())).toBeLessThan(2);

      harnessRef.current?.appendMessage();
      await waitForLayout();
      await harnessRef.current?.scrollToEnd();

      await expect.poll(() => distanceFromBottom(harnessRef.current!.snapshot())).toBeLessThan(2);
      expect(harnessRef.current?.snapshot().lastRenderedRowId).toBe(
        `message-${TIMELINE_ROW_COUNT}`,
      );
    } finally {
      await screen.unmount();
    }
  });

  it("keeps a visible anchor stable when older rows are prepended", async () => {
    await page.viewport(1_000, 760);
    const harnessRef = createRef<TimelineHarnessHandle>();
    const screen = await render(<TimelineHarness ref={harnessRef} />);

    try {
      await waitForLayout();
      await harnessRef.current?.scrollToOffset(1_800);
      await waitForLayout();

      const anchor = harnessRef.current?.captureAnchor();
      expect(anchor).not.toBeNull();
      const beforeTop = harnessRef.current?.anchorElementTop(anchor?.anchorId ?? "");
      expect(beforeTop).not.toBeNull();

      harnessRef.current?.prependMessages();
      await waitForLayout();

      const afterTop = harnessRef.current?.anchorElementTop(anchor?.anchorId ?? "");
      expect(afterTop).not.toBeNull();
      expect(Math.abs((afterTop ?? 0) - (beforeTop ?? 0))).toBeLessThan(24);
    } finally {
      await screen.unmount();
    }
  });

  it("keeps older anchors stable when a recent tail snapshot is merged", async () => {
    await page.viewport(1_000, 760);
    const harnessRef = createRef<TimelineHarnessHandle>();
    const screen = await render(<TimelineHarness ref={harnessRef} />);

    try {
      await waitForLayout();
      await harnessRef.current?.scrollToOffset(1_800);
      await waitForLayout();

      harnessRef.current?.prependMessages();
      await waitForLayout();

      const anchor = harnessRef.current?.captureAnchor();
      expect(anchor).not.toBeNull();
      const beforeTop = harnessRef.current?.anchorElementTop(anchor?.anchorId ?? "");
      expect(beforeTop).not.toBeNull();

      harnessRef.current?.mergeTailSnapshot();
      await waitForLayout();

      const afterTop = harnessRef.current?.anchorElementTop(anchor?.anchorId ?? "");
      expect(afterTop).not.toBeNull();
      expect(Math.abs((afterTop ?? 0) - (beforeTop ?? 0))).toBeLessThan(24);
      expect(harnessRef.current?.snapshot().lastRenderedRowId).not.toBe("message-0");
    } finally {
      await screen.unmount();
    }
  });

  it("does not create horizontal overflow on narrow screens", async () => {
    const viewportWidth = 390;
    await page.viewport(viewportWidth, 760);
    const createdAt = new Date(MESSAGE_CREATED_AT_MS).toISOString();
    const assistantMessageId = MessageId.make("message-overflow-assistant");
    const screen = await render(
      <TimelineFixture
        width={viewportWidth}
        timelineEntries={[
          {
            id: "work-overflow",
            kind: "work",
            createdAt,
            entry: {
              id: "work-overflow",
              createdAt,
              label: "command",
              tone: "tool",
              command:
                "sed -n '1,260p' apps/web/src/components/chat/MessagesTimeline.realList.browser.tsx",
            },
          },
          {
            id: assistantMessageId,
            kind: "message",
            createdAt,
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: [
                "Implemented the migration off the old list package and onto `react-virtuoso@4.18.7`.",
                "",
                "- Added local wrapper: [VirtualizedList.tsx](apps/web/src/components/virtualization/VirtualizedList.tsx)",
                "- Migrated branch selector virtualization: [BranchToolbarBranchSelector.tsx](apps/web/src/components/BranchToolbarBranchSelector.tsx)",
              ].join("\n"),
              createdAt,
              streaming: false,
            },
          },
        ]}
      />,
    );

    try {
      await waitForLayout();
      const scroller = document.querySelector<HTMLElement>(
        "[data-testid='messages-timeline-list']",
      );
      expect(scroller).not.toBeNull();
      expect(scroller!.scrollWidth).toBeLessThanOrEqual(scroller!.clientWidth + 1);

      const overflowingTimelineElement = Array.from(
        document.querySelectorAll<HTMLElement>("[data-timeline-root], .chat-markdown-file-link"),
      ).find((element) => element.getBoundingClientRect().right > viewportWidth + 1);
      expect(overflowingTimelineElement).toBeUndefined();
    } finally {
      await screen.unmount();
    }
  });
});
