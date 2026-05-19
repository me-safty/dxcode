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

  it("includes parent issues for assigned subtasks", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/rest/api/3/project/search")) {
        return Response.json({
          values: [{ id: "project-1", key: "PROJ" }],
        });
      }

      if (url.includes("/rest/api/3/search/jql")) {
        if (url.includes(encodeURIComponent("assignee = currentUser()"))) {
          return Response.json({
            total: 1,
            issues: [
              {
                key: "PROJ-2",
                fields: {
                  summary: "Assigned subtask",
                  parent: { key: "PROJ-1" },
                  issuetype: { name: "Sub-task" },
                  status: { name: "In Progress" },
                  priority: { name: "Medium" },
                  assignee: { displayName: "Me" },
                  project: { id: "project-1" },
                  updated: "2026-05-19T00:00:00.000Z",
                },
              },
            ],
          });
        }

        if (url.includes(encodeURIComponent('key in ("PROJ-1")'))) {
          return Response.json({
            total: 1,
            issues: [
              {
                key: "PROJ-1",
                fields: {
                  summary: "Parent story",
                  issuetype: { name: "Story" },
                  status: { name: "To Do" },
                  priority: { name: "High" },
                  project: { id: "project-1" },
                  updated: "2026-05-18T00:00:00.000Z",
                },
              },
            ],
          });
        }
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AtlassianIntegrationProvider({
      siteUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
    });

    const page = await provider.listResources({
      account: {
        id: "https://test.atlassian.net",
        provider: "atlassian",
      },
      externalProjectId: "project-1",
    });

    expect(page.items.map((item) => item.displayId)).toEqual(["PROJ-2", "PROJ-1"]);
    expect(page.totalCount).toBe(2);
  });

  it("downloads Jira attachment assets with the authenticated client", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://test.atlassian.net/secure/attachment/10000/example.png") {
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AtlassianIntegrationProvider({
      siteUrl: "https://test.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
    });

    const asset = await provider.downloadAsset(
      "https://test.atlassian.net/secure/attachment/10000/example.png",
    );

    expect(asset).toEqual({
      bytes,
      mimeType: "image/png",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.atlassian.net/secure/attachment/10000/example.png",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "*/*",
        }),
      }),
    );
  });
});
