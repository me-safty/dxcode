import type { RunVcsStackedActionInput } from "@t3tools/client-runtime/state/vcs";
import type { GitActionProgressEvent, GitStackedAction } from "@t3tools/contracts";

export interface WebGitStackedActionInput {
  actionId: string;
  action: GitStackedAction;
  commitMessage?: string;
  featureBranch?: boolean;
  filePaths?: string[];
  commitPatch?: string;
  onProgress?: (event: GitActionProgressEvent) => void;
}

/** Keep every optional commit-selection field intact across the React action wrapper. */
export function buildRunVcsStackedActionInput(
  input: WebGitStackedActionInput,
): RunVcsStackedActionInput {
  return {
    actionId: input.actionId,
    action: input.action,
    ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
    ...(input.featureBranch ? { featureBranch: true } : {}),
    ...(input.filePaths?.length ? { filePaths: input.filePaths } : {}),
    ...(input.commitPatch ? { commitPatch: input.commitPatch } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  };
}
