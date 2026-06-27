import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ATLASSIAN_API_BASE, listAccessibleResources } from "./oauth.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listAccessibleResources", () => {
  it("requests accessible resources from api.atlassian.com", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        {
          id: "cloud-123",
          url: "https://example.atlassian.net",
          name: "Example",
          scopes: ["read:jira-work"],
        },
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const sites = await listAccessibleResources("access-token");

    expect(fetchMock).toHaveBeenCalledWith(
      `${ATLASSIAN_API_BASE}/oauth/token/accessible-resources`,
      {
        headers: {
          Authorization: "Bearer access-token",
          Accept: "application/json",
        },
      },
    );
    expect(sites).toEqual([
      {
        id: "cloud-123",
        url: "https://example.atlassian.net",
        name: "Example",
        scopes: ["read:jira-work"],
      },
    ]);
  });
});
