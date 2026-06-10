import { scopedProjectKey } from "@t3tools/client-runtime";
import {
  DEFAULT_RUNTIME_MODE,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { serializeComposerMentionPath } from "@t3tools/shared/composerTrigger";

import { useComposerDraftStore } from "../../composerDraftStore";
import { newDraftId, newThreadId } from "../../lib/utils";
import type { EditorMentionRef } from "./EditorPanel";

/**
 * Build the composer text for an editor selection: an `@file` mention of the
 * path plus the selected lines as a fenced code block.
 */
function formatMention(ref: EditorMentionRef): string {
  // fromLine <= 0 means no precise line info (e.g. a WYSIWYG markdown selection).
  const lineLabel =
    ref.fromLine <= 0
      ? ""
      : ref.fromLine === ref.toLine
        ? ` (L${ref.fromLine})`
        : ` (L${ref.fromLine}-L${ref.toLine})`;
  const fence = "```";
  return `@${serializeComposerMentionPath(ref.relativePath)}${lineLabel}:\n${fence}\n${ref.text}\n${fence}\n`;
}

/** Append a selection mention to an existing chat's composer draft. */
export function appendMentionToChatComposer(
  threadRef: ScopedThreadRef,
  ref: EditorMentionRef,
): void {
  const store = useComposerDraftStore.getState();
  const existing = store.getComposerDraft(threadRef)?.prompt ?? "";
  const mention = formatMention(ref);
  const next = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${mention}` : mention;
  store.setPrompt(threadRef, next);
}

/**
 * Create a new draft chat for a project seeded with a selection mention, then
 * navigate to it. Used when mentioning from the standalone project editor.
 */
export async function startChatWithMention(
  projectRef: ScopedProjectRef,
  ref: EditorMentionRef,
  navigate: (options: { to: "/draft/$draftId"; params: { draftId: string } }) => Promise<void>,
): Promise<void> {
  const store = useComposerDraftStore.getState();
  const draftId = newDraftId();
  const threadId = newThreadId();
  const createdAt = new Date().toISOString();
  store.setLogicalProjectDraftThreadId(scopedProjectKey(projectRef), projectRef, draftId, {
    threadId,
    createdAt,
    branch: null,
    worktreePath: null,
    envMode: "local",
    runtimeMode: DEFAULT_RUNTIME_MODE,
  });
  store.setPrompt(draftId, formatMention(ref));
  await navigate({ to: "/draft/$draftId", params: { draftId } });
}
