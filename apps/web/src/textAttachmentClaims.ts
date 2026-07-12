import type { ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerThreadTarget, DraftId } from "./composerDraftStore";
import { textAttachmentPaths } from "./textAttachmentPaths";

export function textAttachmentDraftOwnerId(target: ScopedThreadRef | DraftId): string {
  return typeof target === "string"
    ? `draft:${target}`
    : `thread:${target.environmentId}:${target.threadId}`;
}

export function textAttachmentClaimChanges(
  previousPaths: ReadonlySet<string>,
  prompt: string,
): { claim: string[]; release: string[]; nextPaths: Set<string> } {
  const nextPaths = new Set(textAttachmentPaths(prompt));
  return {
    claim: [...nextPaths].filter((path) => !previousPaths.has(path)),
    release: [...previousPaths].filter((path) => !nextPaths.has(path)),
    nextPaths,
  };
}

export function textAttachmentClaims(
  target: ComposerThreadTarget,
  prompt: string,
): Array<{ path: string; draftOwnerId: string }> {
  const draftOwnerId = textAttachmentDraftOwnerId(target);
  return textAttachmentPaths(prompt).map((path) => ({ path, draftOwnerId }));
}
