// EMPOWERRD: fork-owned, pure Jira helpers. Isolated here so upstream syncs
// never touch them. Reused by the server RPC handler, the web toolbar control,
// and the header ticket button. The default worktree branch prefix is the
// single upstream constant (renamed to "empcode" via a fenced edit in git.ts).
import { sanitizeBranchFragment, WORKTREE_BRANCH_PREFIX } from "./git.ts";

/** Default temporary-worktree branch prefix (mirrors the upstream constant). */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = WORKTREE_BRANCH_PREFIX;

/** Canonical Jira issue-key shape, e.g. `PLAT-123`. */
const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
/** Temporary-worktree branch suffix: an 8-char hex token. */
const TEMPORARY_WORKTREE_BRANCH_SUFFIX_PATTERN = /^[0-9a-f]{8}$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a worktree branch prefix. Empty input falls back to the default
 * temp prefix; Jira-style keys are uppercased; everything else is sanitized
 * into a branch-safe fragment.
 */
export function normalizeWorktreeBranchPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return DEFAULT_WORKTREE_BRANCH_PREFIX;
  }

  const normalizedUpper = trimmed.toUpperCase();
  if (JIRA_KEY_PATTERN.test(normalizedUpper)) {
    return normalizedUpper;
  }

  return sanitizeBranchFragment(trimmed);
}

/**
 * Match any branch in temporary-worktree shape — `<prefix>/<8-hex>` — where
 * the prefix is either the default temp prefix or a Jira-style key. Useful
 * when the current branch's prefix may not equal the desired prefix (e.g. the
 * user assigned a Jira key to a thread that already had an `empcode/...` temp
 * branch).
 */
export function isTemporaryWorktreeBranchForAnyPrefix(branch: string): boolean {
  const trimmed = branch.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return false;
  }
  const prefix = trimmed.slice(0, slashIndex);
  const suffix = trimmed.slice(slashIndex + 1);
  if (!TEMPORARY_WORKTREE_BRANCH_SUFFIX_PATTERN.test(suffix)) {
    return false;
  }
  return prefix.toLowerCase() === DEFAULT_WORKTREE_BRANCH_PREFIX || JIRA_KEY_PATTERN.test(prefix);
}

/** Return the slash-separated suffix of a namespaced branch, or null. */
export function deriveWorktreeBranchSuffix(branch: string): string | null {
  const trimmed = branch.trim().replace(/^refs\/heads\//, "");
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(slashIndex + 1);
}

/** Build a `<prefix>/<suffix>` branch name with both parts normalized. */
export function buildSemanticWorktreeBranchName(prefix: string, suffix: string): string {
  const normalizedPrefix = normalizeWorktreeBranchPrefix(prefix);
  const normalizedSuffix = sanitizeBranchFragment(suffix);
  return `${normalizedPrefix}/${normalizedSuffix.length > 0 ? normalizedSuffix : "update"}`;
}

/**
 * Compute the target branch name when assigning a Jira key to an existing
 * branch. Used by both the dialog preview on the client and the rename
 * dispatch on the server, so the two stay in lockstep.
 *
 * - If the current branch is a temporary placeholder (any recognized prefix),
 *   the random hex suffix is meaningless — replace it with a sanitized
 *   fragment of the thread title.
 * - Otherwise the existing suffix is preserved (just re-prefixed with the
 *   new Jira key), which keeps user-meaningful branch names stable.
 */
export function buildRenamedJiraBranchName(input: {
  readonly currentBranch: string;
  readonly newJiraKey: string;
  readonly fallbackTitle: string;
}): string {
  const isTemporary = isTemporaryWorktreeBranchForAnyPrefix(input.currentBranch);
  const titleFragment = sanitizeBranchFragment(input.fallbackTitle);
  const suffix = isTemporary
    ? titleFragment
    : (deriveWorktreeBranchSuffix(input.currentBranch) ?? titleFragment);
  return buildSemanticWorktreeBranchName(input.newJiraKey, suffix);
}

/** True when a branch name resolves to `main` or `master` (never renamed). */
export function isMainOrMasterBranchName(branch: string): boolean {
  const normalized = branch
    .trim()
    .replace(/^refs\/heads\//, "")
    .toLowerCase();
  return normalized === "main" || normalized === "master";
}

/** Normalize a Jira domain to its bare subdomain (e.g. `example`). */
export function normalizeJiraDomain(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "")
    .replace(/\.atlassian\.net$/i, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

/** Normalize a Jira project key (uppercase, must start with a letter), or null. */
export function normalizeJiraProjectKey(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toUpperCase();
  if (!trimmed || !/^[A-Z][A-Z0-9]*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Help the user reach a full Jira key when a project key is configured.
 *
 * - No (or invalid) project key → input unchanged.
 * - Empty input → empty.
 * - Already starts with `<KEY>-` (case-insensitive) → uppercase-normalize
 *   (never double-prefix).
 * - Bare number → `<KEY>-<number>`.
 * - Otherwise (partial alpha mid-typing) → input unchanged.
 */
export function applyProjectKeyPrefix(input: string, projectKey?: string | null): string {
  const normalizedProjectKey = normalizeJiraProjectKey(projectKey);
  if (!normalizedProjectKey) {
    return input;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.toUpperCase().startsWith(`${normalizedProjectKey}-`)) {
    return trimmed.toUpperCase();
  }
  if (/^\d+$/.test(trimmed)) {
    return `${normalizedProjectKey}-${trimmed}`;
  }
  return trimmed;
}

/**
 * Validate and normalize a Jira key from raw input. Applies project-key
 * auto-prefixing first, then validates against the configured project key (if
 * any) or the generic Jira-key pattern. Empty input is valid (clears the key).
 */
export function validateJiraKeyInput(
  raw: string,
  projectKey?: string | null,
): { normalized: string | null; error: string | null } {
  const prefixed = applyProjectKeyPrefix(raw, projectKey);
  const trimmed = prefixed.trim();
  if (trimmed.length === 0) {
    return { normalized: null, error: null };
  }

  const normalized = trimmed.toUpperCase();
  const normalizedProjectKey = normalizeJiraProjectKey(projectKey);
  const pattern = normalizedProjectKey
    ? new RegExp(`^${escapeRegExp(normalizedProjectKey)}-\\d+$`)
    : JIRA_KEY_PATTERN;
  if (!pattern.test(normalized)) {
    return {
      normalized: null,
      error: normalizedProjectKey
        ? `Use a Jira key like ${normalizedProjectKey}-123.`
        : "Use a Jira key like ABC-123.",
    };
  }

  return { normalized, error: null };
}

/** Deep-link to an existing Jira issue. */
export function buildJiraTicketUrl(domain: string, jiraKey: string): string {
  const normalizedDomain = normalizeJiraDomain(domain);
  return `https://${normalizedDomain}.atlassian.net/browse/${jiraKey}`;
}

/** Link to the Jira "create issue" page for a domain. */
export function buildJiraCreateTicketUrl(domain: string): string {
  const normalizedDomain = normalizeJiraDomain(domain);
  return `https://${normalizedDomain}.atlassian.net/secure/CreateIssue.jspa`;
}
