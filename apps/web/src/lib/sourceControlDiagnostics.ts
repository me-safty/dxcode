import { downloadPlanAsTextFile } from "../proposedPlan";

export type SourceControlDiagnosticAction = "stage" | "unstage" | "revert";

export type SourceControlActionDisabledReason =
  | "git-action-running"
  | "finalizing-action"
  | "pushing"
  | "stage-files-pending"
  | "unstage-files-pending"
  | "revert-unstaged-files-pending";

export interface SourceControlActionDisabledSnapshot {
  readonly environmentId: string | null;
  readonly cwd: string | null;
  readonly actionDisabled: boolean;
  readonly actionDisabledReasons: readonly SourceControlActionDisabledReason[];
  readonly isGitActionRunning: boolean;
  readonly isGitActionRunningRaw: boolean;
  readonly isFinalizingAction: boolean;
  readonly isPushing: boolean;
  readonly isStageOperationRunning: boolean;
  readonly stageFilesPending: boolean;
  readonly unstageFilesPending: boolean;
  readonly revertUnstagedFilesPending: boolean;
  readonly pendingStageCount: number;
  readonly pendingUnstageCount: number;
  readonly pendingRevertCount: number;
  readonly stagedFileCount: number;
  readonly unstagedFileCount: number;
  readonly hasChanges: boolean;
  readonly gitStatusAvailable: boolean;
  readonly gitStatusError: string | null;
}

export type SourceControlDiagnosticsExportResult = "shared" | "downloaded" | "copied";

export type SourceControlDiagnosticEvent =
  | {
      readonly kind: "disabled-state";
      readonly snapshot: SourceControlActionDisabledSnapshot;
    }
  | {
      readonly kind: "row-action-requested";
      readonly action: SourceControlDiagnosticAction;
      readonly filePaths: readonly string[];
      readonly before: SourceControlActionDisabledSnapshot;
    }
  | {
      readonly kind: "row-action-error";
      readonly action: SourceControlDiagnosticAction;
      readonly filePaths: readonly string[];
      readonly errorMessage: string;
    }
  | {
      readonly kind: "row-action-settled";
      readonly action: SourceControlDiagnosticAction;
      readonly filePaths: readonly string[];
    }
  | {
      readonly kind: "mutation-start";
      readonly action: SourceControlDiagnosticAction;
      readonly environmentId: string | null;
      readonly cwd: string | null;
      readonly filePaths: readonly string[];
    }
  | {
      readonly kind: "mutation-success";
      readonly action: SourceControlDiagnosticAction;
      readonly environmentId: string | null;
      readonly cwd: string | null;
    }
  | {
      readonly kind: "mutation-error";
      readonly action: SourceControlDiagnosticAction;
      readonly environmentId: string | null;
      readonly cwd: string | null;
      readonly errorMessage: string;
    }
  | {
      readonly kind: "git-query-invalidation-scheduled";
      readonly action: SourceControlDiagnosticAction;
      readonly queryKey: readonly unknown[];
    }
  | {
      readonly kind: "pointer-hit-test";
      readonly pointerType: string;
      readonly clientX: number;
      readonly clientY: number;
      readonly elementTag: string | null;
      readonly elementAriaLabel: string | null;
      readonly buttonAriaLabel: string | null;
      readonly buttonDisabled: boolean | null;
      readonly sourceControlAction: string | null;
      readonly sourceControlPath: string | null;
      readonly sourceControlRowKey: string | null;
      readonly snapshot: SourceControlActionDisabledSnapshot;
    };

interface RecordedSourceControlDiagnosticEvent {
  readonly sequence: number;
  readonly recordedAt: string;
  readonly tMs: number;
  readonly event: SourceControlDiagnosticEvent;
}

const MAX_EVENTS = 500;
const events: RecordedSourceControlDiagnosticEvent[] = [];
let firstEventAt = 0;
let nextSequence = 1;
let previousDisabledSnapshot: SourceControlActionDisabledSnapshot | null = null;

export function sourceControlActionDisabledReasons(input: {
  readonly isGitActionRunningRaw: boolean;
  readonly isFinalizingAction: boolean;
  readonly isPushing: boolean;
  readonly stageFilesPending: boolean;
  readonly unstageFilesPending: boolean;
  readonly revertUnstagedFilesPending: boolean;
}): SourceControlActionDisabledReason[] {
  const reasons: SourceControlActionDisabledReason[] = [];
  if (input.isGitActionRunningRaw) reasons.push("git-action-running");
  if (input.isFinalizingAction) reasons.push("finalizing-action");
  if (input.isPushing) reasons.push("pushing");
  if (input.stageFilesPending) reasons.push("stage-files-pending");
  if (input.unstageFilesPending) reasons.push("unstage-files-pending");
  if (input.revertUnstagedFilesPending) reasons.push("revert-unstaged-files-pending");
  return reasons;
}

export function recordSourceControlDiagnosticEvent(event: SourceControlDiagnosticEvent): void {
  const now = Date.now();
  if (firstEventAt === 0) {
    firstEventAt = now;
  }

  events.push({
    sequence: nextSequence,
    recordedAt: new Date(now).toISOString(),
    tMs: now - firstEventAt,
    event,
  });
  nextSequence += 1;

  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function recordSourceControlDisabledSnapshot(
  snapshot: SourceControlActionDisabledSnapshot,
): void {
  if (!shouldRecordDisabledSnapshot(previousDisabledSnapshot, snapshot)) {
    previousDisabledSnapshot = snapshot;
    return;
  }

  previousDisabledSnapshot = snapshot;
  recordSourceControlDiagnosticEvent({
    kind: "disabled-state",
    snapshot,
  });
}

export function buildSourceControlDiagnosticsReport(input?: {
  readonly currentSnapshot?: SourceControlActionDisabledSnapshot;
}): string {
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    browser: readBrowserSnapshot(),
    currentSnapshot: input?.currentSnapshot ?? previousDisabledSnapshot,
    eventSummary: buildEventSummary(),
    latestDisabledState: findLatestDisabledStateEvent()?.event,
    events,
  };

  const lines: string[] = [
    "# Source-control diagnostics",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Browser/device snapshot",
    `- User agent: ${report.browser.userAgent}`,
    `- Viewport: ${formatViewport(report.browser)}`,
    `- Device pixel ratio: ${String(report.browser.devicePixelRatio)}`,
    "",
    "## Current disabled snapshot",
    ...formatDisabledSnapshotLines(report.currentSnapshot),
    "",
    "## Event summary",
    `- Total events retained: ${events.length.toString()}`,
    `- Buffer cap: ${MAX_EVENTS.toString()}`,
    ...Object.entries(report.eventSummary.countsByKind)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `- ${kind}: ${count.toString()}`),
    "",
    "## Latest disabled-state event",
    ...formatDisabledSnapshotLines(
      report.latestDisabledState?.kind === "disabled-state"
        ? report.latestDisabledState.snapshot
        : null,
    ),
    "",
    "## Timeline",
    "tMs\tsequence\tkind\taction\tdisabledReasons\tfilePaths\tdetails",
    ...events.map(formatTimelineEvent),
    "",
    "## Raw JSON snapshot",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  ];

  return lines.join("\n");
}

export async function exportSourceControlDiagnostics(input?: {
  readonly currentSnapshot?: SourceControlActionDisabledSnapshot;
}): Promise<SourceControlDiagnosticsExportResult> {
  const report = buildSourceControlDiagnosticsReport(input);
  const filename = `source-control-diagnostics-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.md`;

  if (canShareFile()) {
    const file = new File([report], filename, { type: "text/markdown;charset=utf-8" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Source-control diagnostics" });
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return "shared";
        }
      }
    }
  }

  try {
    downloadPlanAsTextFile(filename, report);
    return "downloaded";
  } catch {
    // Last resort below.
  }

  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(report);
    return "copied";
  }

  throw new Error("No available export method on this device");
}

export function clearSourceControlDiagnosticsForTests(): void {
  events.length = 0;
  firstEventAt = 0;
  nextSequence = 1;
  previousDisabledSnapshot = null;
}

function shouldRecordDisabledSnapshot(
  previous: SourceControlActionDisabledSnapshot | null,
  next: SourceControlActionDisabledSnapshot,
): boolean {
  if (!previous) return true;
  if (previous.actionDisabled !== next.actionDisabled) return true;
  if (!stringArraysEqual(previous.actionDisabledReasons, next.actionDisabledReasons)) return true;

  if (!next.actionDisabled) return false;

  return (
    previous.stageFilesPending !== next.stageFilesPending ||
    previous.unstageFilesPending !== next.unstageFilesPending ||
    previous.revertUnstagedFilesPending !== next.revertUnstagedFilesPending
  );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildEventSummary(): {
  readonly countsByKind: Record<string, number>;
} {
  const countsByKind: Record<string, number> = {};
  for (const event of events) {
    countsByKind[event.event.kind] = (countsByKind[event.event.kind] ?? 0) + 1;
  }
  return { countsByKind };
}

function findLatestDisabledStateEvent(): RecordedSourceControlDiagnosticEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.event.kind === "disabled-state") {
      return events[index] ?? null;
    }
  }
  return null;
}

function readBrowserSnapshot(): {
  readonly userAgent: string;
  readonly viewportWidth: number | null;
  readonly viewportHeight: number | null;
  readonly devicePixelRatio: number | null;
} {
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    viewportWidth: typeof window !== "undefined" ? window.innerWidth : null,
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : null,
    devicePixelRatio: typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : null,
  };
}

function formatViewport(input: {
  readonly viewportWidth: number | null;
  readonly viewportHeight: number | null;
}): string {
  if (input.viewportWidth === null || input.viewportHeight === null) return "unknown";
  return `${input.viewportWidth.toString()}x${input.viewportHeight.toString()}`;
}

function formatDisabledSnapshotLines(
  snapshot: SourceControlActionDisabledSnapshot | null | undefined,
): string[] {
  if (!snapshot) return ["- none"];
  return [
    `- actionDisabled: ${String(snapshot.actionDisabled)}`,
    `- actionDisabledReasons: ${snapshot.actionDisabledReasons.join(", ") || "none"}`,
    `- environmentId: ${snapshot.environmentId ?? "none"}`,
    `- cwd: ${snapshot.cwd ?? "none"}`,
    `- isGitActionRunning: ${String(snapshot.isGitActionRunning)}`,
    `- isGitActionRunningRaw: ${String(snapshot.isGitActionRunningRaw)}`,
    `- isFinalizingAction: ${String(snapshot.isFinalizingAction)}`,
    `- isPushing: ${String(snapshot.isPushing)}`,
    `- isStageOperationRunning: ${String(snapshot.isStageOperationRunning)}`,
    `- stageFilesPending: ${String(snapshot.stageFilesPending)}`,
    `- unstageFilesPending: ${String(snapshot.unstageFilesPending)}`,
    `- revertUnstagedFilesPending: ${String(snapshot.revertUnstagedFilesPending)}`,
    `- pendingStageCount: ${snapshot.pendingStageCount.toString()}`,
    `- pendingUnstageCount: ${snapshot.pendingUnstageCount.toString()}`,
    `- pendingRevertCount: ${snapshot.pendingRevertCount.toString()}`,
    `- stagedFileCount: ${snapshot.stagedFileCount.toString()}`,
    `- unstagedFileCount: ${snapshot.unstagedFileCount.toString()}`,
    `- hasChanges: ${String(snapshot.hasChanges)}`,
    `- gitStatusAvailable: ${String(snapshot.gitStatusAvailable)}`,
    `- gitStatusError: ${snapshot.gitStatusError ?? "none"}`,
  ];
}

function formatTimelineEvent(recordedEvent: RecordedSourceControlDiagnosticEvent): string {
  const event = recordedEvent.event;
  const action =
    event.kind === "pointer-hit-test"
      ? (event.sourceControlAction ?? "")
      : "action" in event
        ? event.action
        : "";
  const filePaths =
    event.kind === "pointer-hit-test"
      ? (event.sourceControlPath ?? "")
      : "filePaths" in event
        ? event.filePaths.join(", ")
        : "";
  const disabledReasons =
    event.kind === "disabled-state"
      ? event.snapshot.actionDisabledReasons.join(", ")
      : event.kind === "row-action-requested"
        ? event.before.actionDisabledReasons.join(", ")
        : event.kind === "pointer-hit-test"
          ? event.snapshot.actionDisabledReasons.join(", ")
          : "";
  const details =
    event.kind === "pointer-hit-test"
      ? [
          `pointerType=${event.pointerType}`,
          `client=${event.clientX.toString()},${event.clientY.toString()}`,
          `elementTag=${event.elementTag ?? "none"}`,
          `elementAriaLabel=${event.elementAriaLabel ?? "none"}`,
          `buttonAriaLabel=${event.buttonAriaLabel ?? "none"}`,
          `buttonDisabled=${event.buttonDisabled === null ? "unknown" : String(event.buttonDisabled)}`,
          `rowKey=${event.sourceControlRowKey ?? "none"}`,
        ].join("; ")
      : "";
  return [
    recordedEvent.tMs.toString(),
    recordedEvent.sequence.toString(),
    event.kind,
    action,
    disabledReasons,
    filePaths,
    details,
  ].join("\t");
}

function canShareFile(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof File !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function"
  );
}
