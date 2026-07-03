import { ApprovalRequestId, type OrchestrationThreadActivity } from "@t3tools/contracts";

export type WorkflowPendingRequest =
  | { readonly kind: "request"; readonly requestId: ApprovalRequestId }
  | {
      readonly kind: "user-input";
      readonly requestId: ApprovalRequestId;
      readonly questionId?: string | undefined;
      readonly prompt?: string | undefined;
    };

const staleUserInputDetails = [
  "stale pending user-input request",
  "unknown pending user-input request",
  "unknown pending user input request",
  "unknown pending codex user input request",
] as const;

const staleApprovalDetails = [
  // Approval pending-state is derived from activities here, so mirror user-input stale exclusion rather than core pending-approvals status.
  "stale pending approval request",
  "unknown pending approval request",
  "unknown pending permission request",
] as const;

const payloadObject = (payload: unknown): Record<string, unknown> | null =>
  typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;

const requestIdOf = (activity: OrchestrationThreadActivity): string | null => {
  const payload = payloadObject(activity.payload);
  const requestId = payload?.requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : null;
};

const detailOf = (activity: OrchestrationThreadActivity): string => {
  const detail = payloadObject(activity.payload)?.detail;
  return typeof detail === "string" ? detail.toLowerCase() : "";
};

const questionOf = (activity: OrchestrationThreadActivity) => {
  const questions = payloadObject(activity.payload)?.questions;
  const first = Array.isArray(questions) ? questions[0] : undefined;
  if (typeof first !== "object" || first === null) {
    return {};
  }
  const question = first as Record<string, unknown>;
  return {
    ...(typeof question.id === "string" ? { questionId: question.id } : {}),
    ...(typeof question.question === "string" ? { prompt: question.question } : {}),
  };
};

const compareActivity = (
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number =>
  left.createdAt.localeCompare(right.createdAt) || String(left.id).localeCompare(String(right.id));

const isLater = (
  candidate: OrchestrationThreadActivity,
  base: OrchestrationThreadActivity,
): boolean => compareActivity(candidate, base) > 0;

const isStaleApprovalFailure = (activity: OrchestrationThreadActivity): boolean =>
  activity.kind === "provider.approval.respond.failed" &&
  staleApprovalDetails.some((needle) => detailOf(activity).includes(needle));

const isApprovalResolver = (activity: OrchestrationThreadActivity): boolean =>
  activity.kind === "approval.resolved" || isStaleApprovalFailure(activity);

const isStaleUserInputFailure = (activity: OrchestrationThreadActivity): boolean =>
  staleUserInputDetails.some((needle) => detailOf(activity).includes(needle));

export const resolvePendingRequest = (
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WorkflowPendingRequest | null => {
  const requestedApprovals = activities
    .filter((activity) => activity.kind === "approval.requested" && requestIdOf(activity) !== null)
    .toSorted(compareActivity);
  for (const requested of requestedApprovals) {
    const requestId = requestIdOf(requested);
    if (requestId === null) {
      continue;
    }
    const hasLaterResolver = activities.some(
      (activity) =>
        requestIdOf(activity) === requestId &&
        isLater(activity, requested) &&
        isApprovalResolver(activity),
    );
    if (!hasLaterResolver) {
      return { kind: "request", requestId: ApprovalRequestId.make(requestId) };
    }
  }

  const latestUserInputByRequest = new Map<string, OrchestrationThreadActivity>();
  for (const activity of activities) {
    if (
      activity.kind !== "user-input.requested" &&
      activity.kind !== "user-input.resolved" &&
      activity.kind !== "provider.user-input.respond.failed"
    ) {
      continue;
    }
    const requestId = requestIdOf(activity);
    if (requestId === null) {
      continue;
    }
    const existing = latestUserInputByRequest.get(requestId);
    if (existing === undefined || compareActivity(activity, existing) > 0) {
      latestUserInputByRequest.set(requestId, activity);
    }
  }

  const userInputCandidates = [...latestUserInputByRequest.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [requestId, latest] of userInputCandidates) {
    if (latest.kind === "user-input.requested") {
      return {
        kind: "user-input",
        requestId: ApprovalRequestId.make(requestId),
        ...questionOf(latest),
      };
    }
    if (latest.kind === "provider.user-input.respond.failed" && !isStaleUserInputFailure(latest)) {
      return {
        kind: "user-input",
        requestId: ApprovalRequestId.make(requestId),
        ...questionOf(latest),
      };
    }
  }

  return null;
};
