import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@v12/client-runtime/environment";
import { squashAtomCommandFailure } from "@v12/client-runtime/state/runtime";
import { DEFAULT_MODEL, ProviderInstanceId, type ModelSelection } from "@v12/contracts";
import { createModelSelection } from "@v12/shared/model";
import { truncate } from "@v12/shared/String";
import { useCallback } from "react";

import {
  type DraftId,
  hasComposerDraftUserContent,
  useComposerDraftStore,
} from "../composerDraftStore";
import { readProject } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

const materializationsInFlight = new Map<string, Promise<boolean>>();

function resolveDraftModelSelection(draftId: DraftId): ModelSelection {
  const store = useComposerDraftStore.getState();
  const draftSession = store.getDraftSession(draftId);
  const composerDraft = store.getComposerDraft(draftId);
  const activeSelection = composerDraft?.activeProvider
    ? composerDraft.modelSelectionByProvider[composerDraft.activeProvider]
    : null;
  if (activeSelection) {
    return activeSelection;
  }
  if (draftSession) {
    const project = readProject(
      scopeProjectRef(draftSession.environmentId, draftSession.projectId),
    );
    if (project?.defaultModelSelection) {
      return project.defaultModelSelection;
    }
  }
  return createModelSelection(ProviderInstanceId.make("codex"), DEFAULT_MODEL);
}

/** Creates a server-backed thread for a local draft that contains user input. */
export function useMaterializeDraftThread() {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });

  return useCallback(
    async (draftId: DraftId): Promise<boolean> => {
      const store = useComposerDraftStore.getState();
      const draftSession = store.getDraftSession(draftId);
      const composerDraft = store.getComposerDraft(draftId);
      if (!draftSession || draftSession.promotedTo || !hasComposerDraftUserContent(composerDraft)) {
        return false;
      }

      const threadRef = scopeThreadRef(draftSession.environmentId, draftSession.threadId);
      const threadKey = scopedThreadKey(threadRef);
      const existing = materializationsInFlight.get(threadKey);
      if (existing) {
        return existing;
      }

      const materialization = (async () => {
        const trimmedPrompt = composerDraft?.prompt.trim() ?? "";
        const result = await createThread({
          environmentId: draftSession.environmentId,
          input: {
            threadId: draftSession.threadId,
            projectId: draftSession.projectId,
            title: trimmedPrompt.length > 0 ? truncate(trimmedPrompt) : "Draft",
            modelSelection: resolveDraftModelSelection(draftId),
            runtimeMode: draftSession.runtimeMode,
            interactionMode: draftSession.interactionMode,
            branch: draftSession.branch,
            worktreePath: draftSession.worktreePath,
            createdAt: draftSession.createdAt,
          },
        });
        if (result._tag === "Failure") {
          throw squashAtomCommandFailure(result);
        }
        useComposerDraftStore.getState().markDraftThreadPromoting(draftId, threadRef);
        return true;
      })().finally(() => {
        materializationsInFlight.delete(threadKey);
      });

      materializationsInFlight.set(threadKey, materialization);
      return materialization;
    },
    [createThread],
  );
}
