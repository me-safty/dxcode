import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { openPullRequestLink, PullRequestLinkOpenError } from "./openPullRequestLink";

describe("openPullRequestLink", () => {
  it("opens the requested pull request URL", async () => {
    const openExternal = vi.fn(async () => undefined);
    const openPreview = vi.fn();
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestLink(
      { shell: { openExternal }, threadRef: null, openPreview, previewSupported: false },
      targetUrl,
    );

    expect(openExternal).toHaveBeenCalledExactlyOnceWith(targetUrl);
    expect(openPreview).not.toHaveBeenCalled();
  });

  it("opens desktop pull request links in the in-app preview", async () => {
    const openExternal = vi.fn(async () => undefined);
    const threadRef = {
      environmentId: "environment-1" as ScopedThreadRef["environmentId"],
      threadId: "thread-1" as ScopedThreadRef["threadId"],
    };
    const snapshot: PreviewSessionSnapshot = {
      threadId: threadRef.threadId,
      tabId: "tab-1",
      navStatus: { _tag: "Idle" as const },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-07-19T00:00:00.000Z",
    };
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const targetUrl = "https://gitlab.com/example/project/-/merge_requests/42";

    await openPullRequestLink(
      {
        shell: { openExternal },
        threadRef,
        openPreview,
        previewSupported: true,
      },
      targetUrl,
    );

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      environmentId: "environment-1",
      input: { threadId: "thread-1", url: targetUrl },
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports bridge failures with a safe target origin", async () => {
    const cause = new Error("desktop shell unavailable");
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123?token=secret";
    const openExternal = vi.fn(async () => Promise.reject(cause));

    const result = openPullRequestLink(
      {
        shell: { openExternal },
        threadRef: null,
        openPreview: vi.fn(),
        previewSupported: false,
      },
      targetUrl,
    );

    await expect(result).rejects.toEqual(
      new PullRequestLinkOpenError({
        targetOrigin: "https://github.com",
        cause,
      }),
    );
    await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("secret"));
  });
});
