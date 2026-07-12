import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  textAttachmentClaimChanges,
  textAttachmentClaims,
  textAttachmentDraftOwnerId,
} from "./textAttachmentClaims";

const PATH = "/var/t3-data/attachments/text/12345678-1234-1234-1234-123456789abc/shared.txt";

describe("text attachment claims", () => {
  it("uses stable owner ids for draft and server composer targets", () => {
    expect(textAttachmentDraftOwnerId(DraftId.make("draft-a"))).toBe("draft:draft-a");
    expect(
      textAttachmentDraftOwnerId(
        scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread-a")),
      ),
    ).toBe("thread:local:thread-a");
  });

  it("claims every hydrated or copied generated link after remount", () => {
    expect(textAttachmentClaimChanges(new Set(), `[shared.txt](${PATH})`)).toMatchObject({
      claim: [PATH],
      release: [],
    });
  });

  it("releases a removed link and reclaims it after rapid undo", () => {
    const removed = textAttachmentClaimChanges(new Set([PATH]), "");
    const restored = textAttachmentClaimChanges(removed.nextPaths, `[shared.txt](${PATH})`);

    expect(removed.release).toEqual([PATH]);
    expect(restored.claim).toEqual([PATH]);
  });

  it("gives copied shared links independent draft claims", () => {
    expect(textAttachmentClaims(DraftId.make("draft-a"), `[shared.txt](${PATH})`)).toEqual([
      { path: PATH, draftOwnerId: "draft:draft-a" },
    ]);
    expect(textAttachmentClaims(DraftId.make("draft-b"), `[shared.txt](${PATH})`)).toEqual([
      { path: PATH, draftOwnerId: "draft:draft-b" },
    ]);
  });
});
