import "../../index.css";

import { MessageId } from "@marcode/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";

import { type TimelineEntry } from "../../session-logic";
import { useRuntimeToolOutputStore } from "../../runtimeToolOutputStore";
import { MessagesTimeline } from "./MessagesTimeline";

const ACTIVE_THREAD_ENVIRONMENT_ID = "environment-local" as never;
const THREAD_ID = "thread-messages-timeline-browser";
const COMMAND_ITEM_ID = "command-item-live";

function isoAt(offsetSeconds: number): string {
  return new Date(Date.parse("2026-03-17T19:12:28.000Z") + offsetSeconds * 1_000).toISOString();
}

function createTimelineEntries(commandDetail?: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (let index = 0; index < 12; index += 1) {
    const userCreatedAt = isoAt(index * 4);
    const assistantCreatedAt = isoAt(index * 4 + 2);
    entries.push({
      id: `entry-user-${index}`,
      kind: "message",
      createdAt: userCreatedAt,
      message: {
        id: MessageId.make(`message-user-${index}`),
        role: "user",
        text: `User message ${index}`,
        createdAt: userCreatedAt,
        turnId: null,
        streaming: false,
      },
    });
    entries.push({
      id: `entry-assistant-${index}`,
      kind: "message",
      createdAt: assistantCreatedAt,
      message: {
        id: MessageId.make(`message-assistant-${index}`),
        role: "assistant",
        text: `Assistant message ${index}\nAssistant detail ${index}`,
        createdAt: assistantCreatedAt,
        turnId: null,
        streaming: false,
      },
    });
  }

  entries.push({
    id: "entry-command-live",
    kind: "work",
    createdAt: isoAt(80),
    entry: {
      id: "work-command-live",
      createdAt: isoAt(80),
      label: "Run tests",
      command: "bun run test",
      tone: "tool",
      itemType: "command_execution",
      itemId: COMMAND_ITEM_ID,
      ...(commandDetail ? { detail: commandDetail } : {}),
    },
  });

  return entries;
}

async function waitForLayout(frames = 2): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
}

async function waitForScrollContainer(host: HTMLElement): Promise<HTMLDivElement> {
  return vi.waitFor(
    () => {
      const container = host.querySelector<HTMLDivElement>("div.overscroll-y-contain");
      expect(container).toBeTruthy();
      return container!;
    },
    { timeout: 8_000, interval: 16 },
  );
}

function bottomGap(scrollContainer: HTMLElement): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
}

async function pinToBottom(scrollContainer: HTMLDivElement): Promise<void> {
  scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  scrollContainer.dispatchEvent(new Event("scroll"));
  await waitForLayout();
}

async function mountTimeline(entries: TimelineEntry[]) {
  function Harness(props: { timelineEntries: TimelineEntry[] }) {
    const listRef = useRef<LegendListRef | null>(null);

    return (
      <div style={{ height: "420px", width: "720px", overflow: "hidden" }}>
        <MessagesTimeline
          threadId={THREAD_ID}
          hasMessages
          isHydrating={false}
          isWorking={false}
          activeTurnInProgress={false}
          activeTurnStartedAt={null}
          listRef={listRef}
          onIsAtEndChange={() => {}}
          timelineEntries={props.timelineEntries}
          completionDividerBeforeEntryId={null}
          completionSummary={null}
          turnDiffSummaryByAssistantMessageId={new Map()}
          changedFilesExpandedByTurnId={{}}
          onSetChangedFilesExpanded={() => {}}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
          markdownCwd={undefined}
          resolvedTheme="light"
          timestampFormat="locale"
          workspaceRoot="/repo/project"
          isSendBusy={false}
          isSessionStarting={false}
          hasPendingAssistantResponse={false}
          isPreparingWorktree={false}
          isCompacting={false}
          onSubagentSelect={() => {}}
          editingUserMessageId={null}
          editingUserMessageText=""
          editingUserMessageImages={[]}
          onStartEditUserMessage={() => {}}
          onChangeEditingUserMessageText={() => {}}
          onAddEditingUserMessageImages={() => {}}
          onRemoveEditingUserMessageImage={() => {}}
          onCancelEditUserMessage={() => {}}
          onSubmitEditUserMessage={() => {}}
          onReplyToSelection={() => {}}
        />
      </div>
    );
  }

  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<Harness timelineEntries={entries} />, { container: host });
  const scrollContainer = await waitForScrollContainer(host);
  await waitForLayout();

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    host,
    scrollContainer,
    cleanup,
  };
}

describe("MessagesTimeline auto-follow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useRuntimeToolOutputStore.getState().clearAll();
  });

  it("stays pinned to the bottom while live command output grows", async () => {
    useRuntimeToolOutputStore.getState().appendOutput(THREAD_ID, COMMAND_ITEM_ID, "boot\nready\n");

    await using mounted = await mountTimeline(createTimelineEntries());
    await pinToBottom(mounted.scrollContainer);

    const initialScrollHeight = mounted.scrollContainer.scrollHeight;

    for (let index = 0; index < 5; index += 1) {
      useRuntimeToolOutputStore
        .getState()
        .appendOutput(
          THREAD_ID,
          COMMAND_ITEM_ID,
          `${Array.from({ length: 4 }, (_, lineIndex) => `line ${index}-${lineIndex}`).join("\n")}\n`,
        );
      await waitForLayout(3);
    }

    await vi.waitFor(
      () => {
        expect(mounted.scrollContainer.scrollHeight).toBeGreaterThan(initialScrollHeight + 24);
        expect(Math.abs(bottomGap(mounted.scrollContainer))).toBeLessThanOrEqual(4);
      },
      { timeout: 8_000, interval: 16 },
    );
  });

  it("stays pinned to the bottom when an overflowed command card expands", async () => {
    const output = Array.from({ length: 40 }, (_, index) => `expanded line ${index}`).join("\n");

    await using mounted = await mountTimeline(createTimelineEntries(output));
    await pinToBottom(mounted.scrollContainer);

    const initialScrollHeight = mounted.scrollContainer.scrollHeight;

    await vi.waitFor(
      () => {
        expect(page.getByRole("button", { name: "Show full output" }).query()).toBeTruthy();
      },
      { timeout: 8_000, interval: 16 },
    );

    await page.getByRole("button", { name: "Show full output" }).click();
    await waitForLayout(3);

    await vi.waitFor(
      () => {
        expect(mounted.scrollContainer.scrollHeight).toBeGreaterThan(initialScrollHeight + 24);
        expect(Math.abs(bottomGap(mounted.scrollContainer))).toBeLessThanOrEqual(4);
      },
      { timeout: 8_000, interval: 16 },
    );
  });
});
