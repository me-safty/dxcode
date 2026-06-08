import { useEffect } from "react";

import type { Project } from "../types";
import { APP_DISPLAY_NAME } from "../branding";

// Joins a page-specific segment with the app name so every tab is
// identifiable, e.g. "repo/worktree" -> "repo/worktree — T3 Code". A blank
// segment (the home page) falls back to the bare app name.
export function formatDocumentTitle(segment?: string | null): string {
  const trimmed = segment?.trim();
  return trimmed ? `${trimmed} · ${APP_DISPLAY_NAME}` : APP_DISPLAY_NAME;
}

// The short project name (e.g. "nextcard"), not the owner-qualified repo
// display name (e.g. "affil-ai/nextcard"). Prefers the bare repository name,
// then the local project name.
export function deriveProjectTitleName(
  project: Pick<Project, "name" | "repositoryIdentity"> | null | undefined,
): string | null {
  if (!project) return null;
  return project.repositoryIdentity?.name?.trim() || project.name?.trim() || null;
}

function basenameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  for (const segment of trimmed.split(/[\\/]/).toReversed()) {
    if (segment.length > 0) return segment;
  }
  return path;
}

// Worktree label shown in the title: the branch name, falling back to the
// worktree folder basename. Returns null for a thread on the local checkout
// (no worktree), so the title collapses to just the repo name.
export function deriveWorktreeTitleLabel(
  worktreePath: string | null | undefined,
  branch: string | null | undefined,
): string | null {
  if (!worktreePath) return null;
  return branch?.trim() || basenameFromPath(worktreePath);
}

// Builds the "[repo]/[worktree]" location segment for a thread, collapsing to
// "[repo]" when the thread runs on the local checkout.
export function buildThreadLocationSegment(input: {
  repoName: string | null;
  worktreeLabel: string | null;
}): string | null {
  const { repoName, worktreeLabel } = input;
  if (!repoName) return worktreeLabel;
  return worktreeLabel ? `${repoName}/${worktreeLabel}` : repoName;
}

// Full thread tab segment: "[repo]/[worktree] · [thread title]". Falls back to
// whichever part is available when the other is missing.
export function buildThreadTitleSegment(input: {
  repoName: string | null;
  worktreeLabel: string | null;
  threadTitle: string | null | undefined;
}): string | null {
  const location = buildThreadLocationSegment(input);
  const title = input.threadTitle?.trim() || null;
  if (location && title) return `${location} · ${title}`;
  return location ?? title;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
