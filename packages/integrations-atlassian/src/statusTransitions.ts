import type { JiraIssueTransition } from "./client.ts";

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
}

export function selectJiraIssueTransitionForStatus(
  transitions: ReadonlyArray<JiraIssueTransition>,
  targetStatus: string,
): JiraIssueTransition | undefined {
  const normalizedTargetStatus = normalize(targetStatus);
  if (normalizedTargetStatus.length === 0) return undefined;

  for (const transition of transitions) {
    if (normalize(transition.to?.name) === normalizedTargetStatus) {
      return transition;
    }
  }

  for (const transition of transitions) {
    if (normalize(transition.name) === normalizedTargetStatus) {
      return transition;
    }
  }

  return undefined;
}

export function formatJiraIssueTransitionNames(
  transitions: ReadonlyArray<JiraIssueTransition>,
): string {
  return transitions
    .map((transition) => transition.to?.name ?? transition.name)
    .filter((name) => typeof name === "string" && name.trim().length > 0)
    .join(", ");
}
