import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { usePreviewStateStore } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

type OpenPreviewMutation<E = unknown> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;

/** Creates a new browser tab. Reopening an existing tab is a separate UI action. */
export async function addBrowserSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
}): Promise<AtomCommandResult<void, E>> {
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: { threadId: input.threadRef.threadId },
  });
  return mapAtomCommandResult(result, (snapshot) => {
    usePreviewStateStore.getState().applyServerSnapshot(input.threadRef, snapshot);
    useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
  });
}
