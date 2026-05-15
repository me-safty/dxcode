/**
 * Pure execution run lifecycle state machine logic.
 *
 * Extracted from Convex mutations so transition rules can be tested
 * deterministically without a Convex runtime.
 */

export type ExecutionRunStatus =
  | "requested"
  | "accepted"
  | "started"
  | "completed"
  | "failed"
  | "interrupted"
  | "reconciling";

export type ExecutionLifecycleType = "started" | "completed" | "failed" | "interrupted";

const TERMINAL_STATUSES: ReadonlySet<ExecutionRunStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
]);

export function isTerminalStatus(status: ExecutionRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function deriveNextStatus(lifecycleType: ExecutionLifecycleType): ExecutionRunStatus {
  switch (lifecycleType) {
    case "started":
      return "started";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
  }
}

export interface LifecycleTransitionResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export function canApplyLifecycleEvent(input: {
  readonly currentStatus: ExecutionRunStatus;
  readonly incomingType: ExecutionLifecycleType;
}): LifecycleTransitionResult {
  const { currentStatus, incomingType } = input;
  const nextStatus = deriveNextStatus(incomingType);

  if (isTerminalStatus(currentStatus) && incomingType === "started") {
    return {
      allowed: false,
      reason: `Cannot re-open terminal run (status: ${currentStatus}) with a started event.`,
    };
  }

  if (isTerminalStatus(currentStatus) && currentStatus !== nextStatus) {
    return {
      allowed: false,
      reason: `Cannot transition from terminal status ${currentStatus} to ${nextStatus}.`,
    };
  }

  return { allowed: true };
}
