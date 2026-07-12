import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DeferredTextAttachmentCleanup,
  isTextAttachmentReferenced,
} from "./deferredTextAttachmentCleanup";

const PATH = "/var/t3-data/attachments/text/12345678-1234-1234-1234-123456789abc/shared.txt";

afterEach(() => {
  vi.useRealTimers();
});

describe("DeferredTextAttachmentCleanup", () => {
  it("cancels deletion when a removed link is rapidly restored", async () => {
    vi.useFakeTimers();
    const cleanup = new DeferredTextAttachmentCleanup(1_000);
    const deletePath = vi.fn();

    cleanup.schedule(PATH, { isReferenced: () => false, deletePath });
    cleanup.cancel(PATH);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(deletePath).not.toHaveBeenCalled();
  });

  it("rechecks retained drafts before deleting", async () => {
    vi.useFakeTimers();
    const cleanup = new DeferredTextAttachmentCleanup(1_000);
    const deletePath = vi.fn();
    const retainedPrompts = [`Shared [shared.txt](${PATH})`];

    cleanup.schedule(PATH, {
      isReferenced: () => isTextAttachmentReferenced(PATH, retainedPrompts),
      deletePath,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(deletePath).not.toHaveBeenCalled();
  });

  it("deletes after the deferral when no draft retains the path", async () => {
    vi.useFakeTimers();
    const cleanup = new DeferredTextAttachmentCleanup(1_000);
    const deletePath = vi.fn();

    cleanup.schedule(PATH, { isReferenced: () => false, deletePath });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(deletePath).toHaveBeenCalledOnce();
  });
});
