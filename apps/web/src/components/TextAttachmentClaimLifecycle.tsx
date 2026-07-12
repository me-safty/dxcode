import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect } from "react";

import { composerDraftEntriesEnvironment } from "../composerDraftStore";
import { useEnvironments } from "../state/environments";
import { assetEnvironment } from "../state/assets";
import { useAtomCommand } from "../state/use-atom-command";
import {
  reconcileTextAttachmentClaimsEnvironment,
  type TextAttachmentClaimOperations,
} from "../textAttachmentClaims";

interface TextAttachmentClaimLifecycleEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: string };
}

export function reconcileConnectedTextAttachmentClaimEnvironments(
  environments: ReadonlyArray<TextAttachmentClaimLifecycleEnvironment>,
  operationsForEnvironment: (environmentId: EnvironmentId) => TextAttachmentClaimOperations,
): void {
  for (const environment of environments) {
    if (environment.connection.phase !== "connected") continue;
    reconcileTextAttachmentClaimsEnvironment(
      environment.environmentId,
      composerDraftEntriesEnvironment(environment.environmentId),
      operationsForEnvironment(environment.environmentId),
    );
  }
}

export function TextAttachmentClaimLifecycle() {
  const { environments } = useEnvironments();
  const claimTextAttachment = useAtomCommand(assetEnvironment.claimTextAttachment, {
    reportFailure: false,
  });
  const releaseTextAttachment = useAtomCommand(assetEnvironment.releaseTextAttachment, {
    reportFailure: false,
  });
  const operationsForEnvironment = useCallback(
    (environmentId: EnvironmentId): TextAttachmentClaimOperations => ({
      claim: async (path, draftOwnerId) => {
        const result = await claimTextAttachment({
          environmentId,
          input: { path, draftOwnerId },
        });
        return result._tag === "Success" && result.value.claimed;
      },
      release: async (path, draftOwnerId) => {
        const result = await releaseTextAttachment({
          environmentId,
          input: { path, draftOwnerId },
        });
        return result._tag === "Success";
      },
    }),
    [claimTextAttachment, releaseTextAttachment],
  );

  useEffect(() => {
    reconcileConnectedTextAttachmentClaimEnvironments(environments, operationsForEnvironment);
  }, [environments, operationsForEnvironment]);

  return null;
}
