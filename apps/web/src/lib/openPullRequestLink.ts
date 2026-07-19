import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { LocalApi, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { type MouseEvent, useCallback } from "react";

import { openUrlInPreview, type OpenPreviewMutation } from "../browser/openFileInPreview";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { previewEnvironment } from "../state/preview";
import { useAtomCommand } from "../state/use-atom-command";

export class PullRequestLinkOpenError extends Schema.TaggedErrorClass<PullRequestLinkOpenError>()(
  "PullRequestLinkOpenError",
  {
    targetOrigin: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(targetUrl: string, cause: unknown): PullRequestLinkOpenError {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      // Keep malformed URLs out of diagnostics while preserving the open failure below.
    }
    return new PullRequestLinkOpenError({ targetOrigin, cause });
  }

  override get message(): string {
    return this.targetOrigin === null
      ? "Unable to open pull request link."
      : `Unable to open pull request link at ${this.targetOrigin}.`;
  }
}

export async function openPullRequestLink(
  input: {
    readonly shell: Pick<LocalApi["shell"], "openExternal">;
    readonly threadRef: ScopedThreadRef | null;
    readonly openPreview: OpenPreviewMutation;
    readonly previewSupported?: boolean;
  },
  targetUrl: string,
): Promise<void> {
  try {
    const previewSupported = input.previewSupported ?? isPreviewSupportedInRuntime();
    if (previewSupported && input.threadRef) {
      const result = await openUrlInPreview({
        threadRef: input.threadRef,
        url: targetUrl,
        openPreview: input.openPreview,
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        throw squashAtomCommandFailure(result);
      }
      return;
    }
    await input.shell.openExternal(targetUrl);
  } catch (cause) {
    throw PullRequestLinkOpenError.fromCause(targetUrl, cause);
  }
}

export function useOpenPullRequestLink() {
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });

  return useCallback(
    async (prUrl: string, threadRef: ScopedThreadRef | null) => {
      const api = readLocalApi();
      if (!api) {
        throw PullRequestLinkOpenError.fromCause(prUrl, new Error("Local API unavailable."));
      }
      await openPullRequestLink({ shell: api.shell, threadRef, openPreview }, prUrl);
    },
    [openPreview],
  );
}

/**
 * Returns a click handler that opens a pull request URL in the desktop preview,
 * falling back to the system browser in runtimes without preview support.
 *
 * Stops event propagation/default so activating the link does not also trigger
 * an enclosing row or trigger (e.g. opening the branch dropdown), and surfaces a
 * toast when the local API is unavailable or the open fails.
 */
export function useOpenPrLink() {
  const openPullRequest = useOpenPullRequestLink();

  return useCallback(
    (event: MouseEvent<HTMLElement>, prUrl: string, threadRef: ScopedThreadRef) => {
      event.preventDefault();
      event.stopPropagation();

      void openPullRequest(prUrl, threadRef).catch((error) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open pull request link",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [openPullRequest],
  );
}
