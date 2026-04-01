import "../../index.css";

import { MessageId, type TurnId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { deriveTimelineEntries, type WorkLogEntry } from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { MessagesTimeline } from "./MessagesTimeline";
import {
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
} from "./MessagesTimeline.logic";

const DEFAULT_VIEWPORT = {
  width: 960,
  height: 1_100,
};
const MARKDOWN_CWD = "/repo/project";

interface RowMeasurement {
  actualHeightPx: number;
  estimatedHeightPx: number;
  timelineWidthPx: number;
  virtualizerSizePx: number;
  renderedInVirtualizedRegion: boolean;
}

interface VirtualizationScenario {
  name: string;
  targetRowId: string;
  props: Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer">;
  maxEstimateDeltaPx: number;
}

function MessagesTimelineBrowserHarness(
  props: Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer">,
) {
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div
      ref={setScrollContainer}
      data-testid="messages-timeline-scroll-container"
      className="h-full overflow-y-auto overscroll-y-contain"
    >
      <MessagesTimeline {...props} scrollContainer={scrollContainer} />
    </div>
  );
}

function isoAt(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 2, 17, 19, 12, 28) + offsetSeconds * 1_000).toISOString();
}

function createMessage(input: {
  id: string;
  role: ChatMessage["role"];
  text: string;
  offsetSeconds: number;
}): ChatMessage {
  return {
    id: MessageId.makeUnsafe(input.id),
    role: input.role,
    text: input.text,
    createdAt: isoAt(input.offsetSeconds),
    ...(input.role === "assistant" ? { completedAt: isoAt(input.offsetSeconds + 1) } : {}),
    streaming: false,
  };
}

function createToolWorkEntry(input: {
  id: string;
  offsetSeconds: number;
  label?: string;
  detail?: string;
}): WorkLogEntry {
  return {
    id: input.id,
    createdAt: isoAt(input.offsetSeconds),
    label: input.label ?? "exec_command completed",
    ...(input.detail ? { detail: input.detail } : {}),
    tone: "tool",
    toolTitle: "exec_command",
  };
}

function createPlan(input: {
  id: string;
  offsetSeconds: number;
  planMarkdown: string;
}): ProposedPlan {
  return {
    id: input.id as ProposedPlan["id"],
    turnId: null,
    planMarkdown: input.planMarkdown,
    implementedAt: null,
    implementationThreadId: null,
    createdAt: isoAt(input.offsetSeconds),
    updatedAt: isoAt(input.offsetSeconds + 1),
  };
}

function createBaseTimelineProps(input: {
  messages?: ChatMessage[];
  proposedPlans?: ProposedPlan[];
  workEntries?: WorkLogEntry[];
  completionDividerBeforeEntryId?: string | null;
  turnDiffSummaryByAssistantMessageId?: Map<MessageId, TurnDiffSummary>;
}): Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer"> {
  return {
    hasMessages: true,
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    timelineEntries: deriveTimelineEntries(
      input.messages ?? [],
      input.proposedPlans ?? [],
      input.workEntries ?? [],
    ),
    completionDividerBeforeEntryId: input.completionDividerBeforeEntryId ?? null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: input.turnDiffSummaryByAssistantMessageId ?? new Map(),
    nowIso: isoAt(10_000),
    expandedWorkGroups: {},
    onToggleWorkGroup: () => {},
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    markdownCwd: MARKDOWN_CWD,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: MARKDOWN_CWD,
  };
}

function createFillerMessages(input: {
  prefix: string;
  startOffsetSeconds: number;
  pairCount: number;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < input.pairCount; index += 1) {
    const baseOffset = input.startOffsetSeconds + index * 4;
    messages.push(
      createMessage({
        id: `${input.prefix}-user-${index}`,
        role: "user",
        text: `filler user message ${index}`,
        offsetSeconds: baseOffset,
      }),
    );
    messages.push(
      createMessage({
        id: `${input.prefix}-assistant-${index}`,
        role: "assistant",
        text: `filler assistant message ${index}`,
        offsetSeconds: baseOffset + 1,
      }),
    );
  }
  return messages;
}

function createChangedFilesSummary(targetMessageId: MessageId): Map<MessageId, TurnDiffSummary> {
  return new Map([
    [
      targetMessageId,
      {
        turnId: "turn-changed-files" as TurnId,
        completedAt: isoAt(10),
        assistantMessageId: targetMessageId,
        files: [
          { path: ".plans/effect-atom.md", additions: 89, deletions: 0 },
          {
            path: "apps/server/src/checkpointing/Layers/CheckpointDiffQuery.ts",
            additions: 4,
            deletions: 3,
          },
          {
            path: "apps/server/src/checkpointing/Layers/CheckpointStore.ts",
            additions: 131,
            deletions: 128,
          },
          {
            path: "apps/server/src/checkpointing/Layers/CheckpointStore.test.ts",
            additions: 1,
            deletions: 1,
          },
          { path: "apps/server/src/checkpointing/Errors.ts", additions: 1, deletions: 1 },
          {
            path: "apps/server/src/git/Layers/ClaudeTextGeneration.ts",
            additions: 106,
            deletions: 112,
          },
          { path: "apps/server/src/git/Layers/GitCore.ts", additions: 44, deletions: 38 },
          { path: "apps/server/src/git/Layers/GitCore.test.ts", additions: 18, deletions: 9 },
          {
            path: "apps/web/src/components/chat/MessagesTimeline.tsx",
            additions: 52,
            deletions: 7,
          },
          {
            path: "apps/web/src/components/chat/ChangedFilesTree.tsx",
            additions: 32,
            deletions: 4,
          },
          { path: "packages/contracts/src/orchestration.ts", additions: 13, deletions: 3 },
          { path: "packages/shared/src/git.ts", additions: 8, deletions: 2 },
        ],
      },
    ],
  ]);
}

function buildStaticScenarios(): VirtualizationScenario[] {
  const beforeMessages = createFillerMessages({
    prefix: "before",
    startOffsetSeconds: 0,
    pairCount: 2,
  });
  const afterMessages = createFillerMessages({
    prefix: "after",
    startOffsetSeconds: 40,
    pairCount: 8,
  });

  const longUserMessage = createMessage({
    id: "target-user-long",
    role: "user",
    text: "x".repeat(3_200),
    offsetSeconds: 12,
  });
  const workEntries = Array.from({ length: 4 }, (_, index) =>
    createToolWorkEntry({
      id: `target-work-${index}`,
      offsetSeconds: 12 + index,
      detail: `tool output line ${index + 1}`,
    }),
  );
  const moderatePlan = createPlan({
    id: "target-plan",
    offsetSeconds: 12,
    planMarkdown: [
      "# Stabilize virtualization",
      "",
      "- Gather baseline measurements",
      "- Add browser harness coverage",
      "- Compare estimated and rendered heights",
      "- Fix the broken rows without broad refactors",
      "- Re-run lint and typecheck",
    ].join("\n"),
  });
  const changedFilesMessage = createMessage({
    id: "target-assistant-changed-files",
    role: "assistant",
    text: "Validation passed on the merged tree.",
    offsetSeconds: 12,
  });

  return [
    {
      name: "long user message",
      targetRowId: longUserMessage.id,
      props: createBaseTimelineProps({
        messages: [...beforeMessages, longUserMessage, ...afterMessages],
      }),
      maxEstimateDeltaPx: 56,
    },
    {
      name: "grouped work log row",
      targetRowId: workEntries[0]!.id,
      props: createBaseTimelineProps({
        messages: [...beforeMessages, ...afterMessages],
        workEntries,
      }),
      maxEstimateDeltaPx: 56,
    },
    {
      name: "proposed plan row",
      targetRowId: moderatePlan.id,
      props: createBaseTimelineProps({
        messages: [...beforeMessages, ...afterMessages],
        proposedPlans: [moderatePlan],
      }),
      maxEstimateDeltaPx: 96,
    },
    {
      name: "assistant changed-files row",
      targetRowId: changedFilesMessage.id,
      props: createBaseTimelineProps({
        messages: [...beforeMessages, changedFilesMessage, ...afterMessages],
        turnDiffSummaryByAssistantMessageId: createChangedFilesSummary(changedFilesMessage.id),
      }),
      maxEstimateDeltaPx: 72,
    },
  ];
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(viewport: { width: number; height: number }): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    { timeout: 4_000, interval: 16 },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function measureTimelineRow(input: {
  host: HTMLElement;
  props: Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer">;
  targetRowId: string;
}): Promise<RowMeasurement> {
  const scrollContainer = await waitForElement(
    () =>
      input.host.querySelector<HTMLDivElement>(
        '[data-testid="messages-timeline-scroll-container"]',
      ),
    "Unable to find MessagesTimeline scroll container.",
  );

  const rowSelector = `[data-timeline-row-id="${input.targetRowId}"]`;
  const virtualRowSelector = `[data-virtual-row-id="${input.targetRowId}"]`;

  let timelineWidthPx = 0;
  let actualHeightPx = 0;
  let virtualizerSizePx = 0;
  let renderedInVirtualizedRegion = false;

  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();

      const rowElement = input.host.querySelector<HTMLElement>(rowSelector);
      const virtualRowElement = input.host.querySelector<HTMLElement>(virtualRowSelector);
      const timelineRoot = input.host.querySelector<HTMLElement>('[data-timeline-root="true"]');

      expect(rowElement, "Unable to locate target timeline row.").toBeTruthy();
      expect(virtualRowElement, "Unable to locate target virtualized wrapper.").toBeTruthy();
      expect(timelineRoot, "Unable to locate MessagesTimeline root.").toBeTruthy();

      timelineWidthPx = timelineRoot!.getBoundingClientRect().width;
      actualHeightPx = rowElement!.getBoundingClientRect().height;
      virtualizerSizePx = Number.parseFloat(virtualRowElement!.dataset.virtualRowSize ?? "0");
      renderedInVirtualizedRegion = virtualRowElement!.hasAttribute("data-index");

      expect(timelineWidthPx).toBeGreaterThan(0);
      expect(actualHeightPx).toBeGreaterThan(0);
      expect(virtualizerSizePx).toBeGreaterThan(0);
      expect(renderedInVirtualizedRegion).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );

  const rows = deriveMessagesTimelineRows({
    timelineEntries: input.props.timelineEntries,
    completionDividerBeforeEntryId: input.props.completionDividerBeforeEntryId,
    isWorking: input.props.isWorking,
    activeTurnStartedAt: input.props.activeTurnStartedAt,
  });
  const targetRow = rows.find((row) => row.id === input.targetRowId);
  expect(targetRow, `Unable to derive target row ${input.targetRowId}.`).toBeTruthy();

  return {
    actualHeightPx,
    estimatedHeightPx: estimateMessagesTimelineRowHeight(targetRow!, { timelineWidthPx }),
    timelineWidthPx,
    virtualizerSizePx,
    renderedInVirtualizedRegion,
  };
}

async function mountMessagesTimeline(input: {
  props: Omit<ComponentProps<typeof MessagesTimeline>, "scrollContainer">;
}) {
  await setViewport(DEFAULT_VIEWPORT);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const screen = await render(<MessagesTimelineBrowserHarness {...input.props} />, {
    container: host,
  });
  await waitForLayout();

  return {
    host,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("MessagesTimeline virtualization harness", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await setViewport(DEFAULT_VIEWPORT);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each(buildStaticScenarios())("keeps the $name estimate within tolerance", async (scenario) => {
    const mounted = await mountMessagesTimeline({ props: scenario.props });

    try {
      const measurement = await measureTimelineRow({
        host: mounted.host,
        props: scenario.props,
        targetRowId: scenario.targetRowId,
      });

      expect(
        Math.abs(measurement.actualHeightPx - measurement.estimatedHeightPx),
        `estimate delta for ${scenario.name}`,
      ).toBeLessThanOrEqual(scenario.maxEstimateDeltaPx);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the changed-files row virtualizer size in sync after collapsing directories", async () => {
    const beforeMessages = createFillerMessages({
      prefix: "before-collapse",
      startOffsetSeconds: 0,
      pairCount: 2,
    });
    const afterMessages = createFillerMessages({
      prefix: "after-collapse",
      startOffsetSeconds: 40,
      pairCount: 8,
    });
    const targetMessage = createMessage({
      id: "target-assistant-collapse",
      role: "assistant",
      text: "Validation passed on the merged tree.",
      offsetSeconds: 12,
    });
    const props = createBaseTimelineProps({
      messages: [...beforeMessages, targetMessage, ...afterMessages],
      turnDiffSummaryByAssistantMessageId: createChangedFilesSummary(targetMessage.id),
    });
    const mounted = await mountMessagesTimeline({ props });

    try {
      const beforeCollapse = await measureTimelineRow({
        host: mounted.host,
        props,
        targetRowId: targetMessage.id,
      });
      const targetRowElement = mounted.host.querySelector<HTMLElement>(
        `[data-timeline-row-id="${targetMessage.id}"]`,
      );
      expect(targetRowElement, "Unable to locate target changed-files row.").toBeTruthy();

      const collapseAllButton =
        Array.from(targetRowElement!.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => button.textContent?.trim() === "Collapse all",
        ) ?? null;
      expect(collapseAllButton, 'Unable to find "Collapse all" button.').toBeTruthy();

      collapseAllButton!.click();

      await vi.waitFor(
        async () => {
          const afterCollapse = await measureTimelineRow({
            host: mounted.host,
            props,
            targetRowId: targetMessage.id,
          });
          expect(afterCollapse.actualHeightPx).toBeLessThan(beforeCollapse.actualHeightPx - 24);
        },
        { timeout: 8_000, interval: 16 },
      );

      const afterCollapse = await measureTimelineRow({
        host: mounted.host,
        props,
        targetRowId: targetMessage.id,
      });
      expect(
        Math.abs(afterCollapse.actualHeightPx - afterCollapse.virtualizerSizePx),
      ).toBeLessThanOrEqual(8);
    } finally {
      await mounted.cleanup();
    }
  });
});
