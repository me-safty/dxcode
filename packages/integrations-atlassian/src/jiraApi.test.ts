import { afterEach, describe, expect, it, vi } from "vitest";

import { AtlassianNetworkError } from "./client.ts";
import { JiraApiClient, JIRA_API_TIMEOUT_MS } from "./jiraApi.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JiraApiClient", () => {
  it("aborts Jira requests that exceed the HTTP timeout", async () => {
    const timeoutController = new AbortController();
    const timeoutSignalSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new JiraApiClient({
      kind: "basic",
      siteUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
    });

    const errorPromise = client.getMyself().catch((error: unknown) => error);
    timeoutController.abort(new Error("timed out"));

    const error = await errorPromise;
    expect(timeoutSignalSpy).toHaveBeenCalledWith(JIRA_API_TIMEOUT_MS);
    expect(error).toBeInstanceOf(AtlassianNetworkError);
    expect(error).toMatchObject({
      _tag: "AtlassianNetworkError",
      cause: expect.objectContaining({
        message: `Atlassian request timed out after ${JIRA_API_TIMEOUT_MS}ms`,
      }),
    });
  });
});
