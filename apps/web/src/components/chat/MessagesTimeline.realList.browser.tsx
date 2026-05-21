import "../../index.css";

import {
  EnvironmentId,
  MessageId,
  type EnvironmentId as EnvironmentIdType,
} from "@t3tools/contracts";
import { createRef, forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { TimelineEntry } from "../../session-logic";
import { MessagesTimeline } from "./MessagesTimeline";

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
  readonly scrollToEnd: () => Promise<void>;
  readonly snapshot: () => ScrollSnapshot;
}

function buildMessageText(role: "assistant" | "user", index: number): string {
  return `${role} message ${index}\n${"body ".repeat(60).trim()}`;
}

function buildTimelineEntry(index: number): TimelineEntry {
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

function getScrollSnapshot(listRef: LegendListRef | null): ScrollSnapshot {
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
  const listRef = useRef<LegendListRef | null>(null);
  const emptyTurnDiffSummary = useMemo(() => new Map(), []);
  const emptyRevertTurnCount = useMemo(() => new Map(), []);

  useImperativeHandle(
    ref,
    () => ({
      appendMessage: () => {
        setTimelineEntries((current) => [...current, buildTimelineEntry(current.length)]);
      },
      scrollToEnd: async () => {
        await listRef.current?.scrollToEnd?.({ animated: false });
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

describe("MessagesTimeline real LegendList scrolling", () => {
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
});
