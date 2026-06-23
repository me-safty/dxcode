// EMPOWERRD: pure decision logic for what a Jira-key save should do to the
// thread's branch. Extracted from the toolbar control so it can be unit-tested
// without the React/RPC machinery.
import {
  buildRenamedJiraBranchName,
  isTemporaryWorktreeBranchForAnyPrefix,
  normalizeWorktreeBranchPrefix,
} from "@t3tools/shared/jira";

export type JiraKeySavePlan =
  /** Persist the key without renaming the branch. */
  | { readonly kind: "save" }
  /** Branch is a throwaway placeholder — rename immediately, no confirmation. */
  | { readonly kind: "autoRename" }
  /** Branch is meaningful — persist the key, then ask before renaming. */
  | { readonly kind: "confirm"; readonly targetBranch: string };

/**
 * Decide how assigning `normalizedJiraKey` should affect the thread's branch.
 *
 * - No branch, or the branch is already prefixed with the key → just save.
 * - Temporary placeholder branch (`<prefix>/<8 hex>`) → auto-rename.
 * - Otherwise → confirm a rename that preserves the existing suffix.
 */
export function resolveJiraKeySavePlan(input: {
  readonly currentBranch: string | null;
  readonly normalizedJiraKey: string;
  readonly title: string;
}): JiraKeySavePlan {
  const { currentBranch, normalizedJiraKey, title } = input;
  if (!currentBranch) {
    return { kind: "save" };
  }

  const currentPrefix = currentBranch.split("/")[0] ?? "";
  if (normalizeWorktreeBranchPrefix(currentPrefix) === normalizedJiraKey) {
    return { kind: "save" };
  }

  if (isTemporaryWorktreeBranchForAnyPrefix(currentBranch)) {
    return { kind: "autoRename" };
  }

  const targetBranch = buildRenamedJiraBranchName({
    currentBranch,
    newJiraKey: normalizedJiraKey,
    fallbackTitle: title,
  });
  if (targetBranch === currentBranch) {
    return { kind: "save" };
  }
  return { kind: "confirm", targetBranch };
}
