import { describe, expect, it } from "vite-plus/test";

import { currentComposerImageCount } from "./composerAttachmentBatch";

describe("currentComposerImageCount", () => {
  it("uses the synchronous draft count between queued batches", () => {
    const staleRefImages = [{ id: "first" }];
    const latestDraft = { images: [{ id: "first" }, { id: "second" }] };

    expect(currentComposerImageCount(latestDraft, staleRefImages)).toBe(2);
  });

  it("falls back to the synchronized ref before a draft exists", () => {
    expect(currentComposerImageCount(null, [{ id: "first" }])).toBe(1);
  });
});
