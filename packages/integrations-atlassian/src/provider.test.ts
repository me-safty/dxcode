import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlassianIntegrationProvider } from "./provider.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("AtlassianIntegrationProvider", () => {
  it("normalizes bare Atlassian domains before connecting", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        accountId: "account-1",
        displayName: "Test User",
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AtlassianIntegrationProvider({
      siteUrl: "test.atlassian.net/",
      email: "user@example.com",
      apiToken: "token",
    });

    const accounts = await provider.listAccounts();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.atlassian.net/rest/api/3/myself",
      expect.any(Object),
    );
    expect(accounts).toEqual([
      {
        id: "https://test.atlassian.net",
        provider: "atlassian",
        label: "Test User",
        accountUrl: "https://test.atlassian.net",
      },
    ]);
  });

  it("surfaces authentication failures instead of returning an empty site list", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));

    const provider = new AtlassianIntegrationProvider({
      siteUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "bad-token",
    });

    await expect(provider.listAccounts()).rejects.toThrow(
      "Failed to connect to Atlassian. https://test.atlassian.net: Authentication failed (401). Check your credentials or re-authenticate.",
    );
  });

  it("explains network failures without hiding the underlying cause", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const provider = new AtlassianIntegrationProvider({
      siteUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
    });

    await expect(provider.listAccounts()).rejects.toThrow(
      "Check that the site URL is correct, the local backend can reach Atlassian, and the API token has Jira access.",
    );
  });
});
