import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  pendingTextAttachmentReleasesEnvironment,
  persistPendingTextAttachmentReleases,
  useComposerDraftStore,
} from "../composerDraftStore";
import { resetTextAttachmentClaimRegistryForTest } from "../textAttachmentClaims";
import { reconcileConnectedTextAttachmentClaimEnvironments } from "./TextAttachmentClaimLifecycle";

afterEach(() => {
  resetTextAttachmentClaimRegistryForTest();
  useComposerDraftStore.setState({ pendingTextAttachmentReleases: [] });
});

describe("TextAttachmentClaimLifecycle", () => {
  it("restores a background environment outbox without a mounted composer", async () => {
    const visibleEnvironmentId = EnvironmentId.make("visible-environment");
    const backgroundEnvironmentId = EnvironmentId.make("background-environment");
    const pendingRelease = {
      environmentId: backgroundEnvironmentId,
      path: "/tmp/background-attachment.txt",
      draftOwnerId: "thread:background:deleted",
    };
    persistPendingTextAttachmentReleases([pendingRelease]);
    resetTextAttachmentClaimRegistryForTest();
    const release = vi.fn(
      async (_environmentId: EnvironmentId, _path: string, _draftOwnerId: string) => true,
    );
    const operationsForEnvironment = (environmentId: EnvironmentId) => ({
      claim: vi.fn(async () => true),
      release: (path: string, draftOwnerId: string) => release(environmentId, path, draftOwnerId),
    });

    reconcileConnectedTextAttachmentClaimEnvironments(
      [
        { environmentId: visibleEnvironmentId, connection: { phase: "connected" } },
        { environmentId: backgroundEnvironmentId, connection: { phase: "connecting" } },
      ],
      operationsForEnvironment,
    );
    expect(release).not.toHaveBeenCalled();
    expect(pendingTextAttachmentReleasesEnvironment(backgroundEnvironmentId)).toEqual([
      pendingRelease,
    ]);

    reconcileConnectedTextAttachmentClaimEnvironments(
      [
        { environmentId: visibleEnvironmentId, connection: { phase: "connected" } },
        { environmentId: backgroundEnvironmentId, connection: { phase: "connected" } },
      ],
      operationsForEnvironment,
    );
    await vi.waitFor(() =>
      expect(pendingTextAttachmentReleasesEnvironment(backgroundEnvironmentId)).toEqual([]),
    );

    expect(release).toHaveBeenCalledWith(
      backgroundEnvironmentId,
      pendingRelease.path,
      pendingRelease.draftOwnerId,
    );
  });
});
