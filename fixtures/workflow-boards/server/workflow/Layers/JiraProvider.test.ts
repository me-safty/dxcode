import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { JiraProvider as JiraProviderTag } from "../Services/WorkSourceProvider.ts";
import { JiraProviderLive } from "./JiraProvider.ts";
import { makeConnectionStoreLayer, makeHttpClientLayer } from "./WorkSourceProvider.testUtils.ts";

const issue = (overrides: Record<string, unknown> = {}) => ({
  key: "ENG-1",
  fields: {
    summary: "Bug: broken",
    description: "Steps to reproduce",
    status: { statusCategory: { key: "indeterminate" } },
    assignee: { displayName: "Alice Smith" },
    labels: ["backend"],
    updated: "2024-01-01T00:00:00.000+0000",
    ...overrides,
  },
});

const layer = (
  responses: Parameters<typeof makeHttpClientLayer>[0],
  auth: {
    readonly token?: string;
    readonly authMode?: "pat" | "basic" | "bearer";
    readonly baseUrl?: string | null;
    readonly email?: string | null;
  } = {},
) => {
  const http = makeHttpClientLayer(responses);
  return {
    request: http.request,
    layer: JiraProviderLive.pipe(
      Layer.provide(http.layer),
      Layer.provide(
        makeConnectionStoreLayer({
          token: auth.token ?? "jira-token",
          authMode: auth.authMode ?? "basic",
          baseUrl: auth.baseUrl ?? "https://acme.atlassian.net",
          email: auth.email ?? "me@acme.test",
          expectedProvider: "jira",
        }),
      ),
    ),
  };
};

describe("JiraProviderLive", () => {
  it.effect("maps issues, builds Basic auth, builds JQL, and paginates by startAt", () => {
    const { request, layer: live } = layer([
      { body: { issues: [issue(), issue({ summary: "Other" })], startAt: 0, total: 5 } },
    ]);

    return Effect.gen(function* () {
      const provider = yield* JiraProviderTag;
      const page = yield* provider.listPage({
        connectionRef: "conn",
        selector: { projectKey: "ENG", jql: "labels = backend" },
        since: "2024-01-01T00:00:00Z",
        pageSize: 2,
      });

      expect(page.nextPageToken).toBe("2");
      expect(page.items[0]!.externalId).toBe("ENG-1");
      expect(page.items[0]!.url).toBe("https://acme.atlassian.net/browse/ENG-1");
      expect(page.items[0]!.fields).toEqual({
        title: "Bug: broken",
        description: "Steps to reproduce",
        assignees: ["Alice Smith"],
        labels: ["backend"],
      });

      const input = request.mock.calls[0]![0];
      const url = new URL(input.url);
      expect(url.origin + url.pathname).toBe("https://acme.atlassian.net/rest/api/2/search");
      expect(url.searchParams.get("jql")).toContain(
        'project = "ENG" AND (labels = backend) AND updated >= "2024-01-01 00:00"',
      );
      expect(url.searchParams.get("fields")).toBe(
        "summary,description,status,assignee,labels,updated",
      );
      const expectedAuth = `Basic ${Buffer.from("me@acme.test:jira-token").toString("base64")}`;
      expect(input.headers?.authorization).toBe(expectedAuth);
    }).pipe(Effect.provide(live));
  });

  it.effect("uses Bearer auth for bearer Jira connections", () => {
    const { request, layer: live } = layer([{ body: { issues: [], startAt: 0, total: 0 } }], {
      token: "server-pat",
      authMode: "bearer",
      baseUrl: "https://jira.corp.example",
      email: null,
    });

    return Effect.gen(function* () {
      const provider = yield* JiraProviderTag;
      yield* provider.listPage({
        connectionRef: "conn",
        selector: { projectKey: "OPS" },
        pageSize: 50,
      });
      expect(request.mock.calls[0]![0].headers?.authorization).toBe("Bearer server-pat");
    }).pipe(Effect.provide(live));
  });

  it.effect("getItem returns null on 404 and a mapped item on 200", () => {
    const { layer: deleted } = layer([{ status: 404, body: { message: "not found" } }]);
    const { layer: existing } = layer([
      { body: issue({ status: { statusCategory: { key: "done" } } }) },
    ]);

    return Effect.gen(function* () {
      const deletedProvider = yield* JiraProviderTag.pipe(Effect.provide(deleted));
      const deletedResult = yield* deletedProvider.getItem({
        connectionRef: "conn",
        selector: { projectKey: "ENG" },
        externalId: "ENG-9",
      });
      expect(deletedResult).toBeNull();

      const existingProvider = yield* JiraProviderTag.pipe(Effect.provide(existing));
      const item = yield* existingProvider.getItem({
        connectionRef: "conn",
        selector: { projectKey: "ENG" },
        externalId: "ENG-1",
      });
      expect(item?.externalId).toBe("ENG-1");
      expect(item?.lifecycle).toBe("closed");
    });
  });

  it.effect("classifies auth, rate-limit, transient errors, and blocked stored base URLs", () =>
    Effect.gen(function* () {
      const authProvider = yield* JiraProviderTag.pipe(
        Effect.provide(layer([{ status: 401, body: { message: "no" } }]).layer),
      );
      const auth = yield* authProvider
        .listPage({ connectionRef: "conn", selector: { projectKey: "ENG" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(auth._tag, "WorkSourceAuthError");

      const rateProvider = yield* JiraProviderTag.pipe(
        Effect.provide(
          layer([{ status: 429, headers: { "Retry-After": "4" }, body: { message: "slow" } }])
            .layer,
        ),
      );
      const rate = yield* rateProvider
        .listPage({ connectionRef: "conn", selector: { projectKey: "ENG" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(rate._tag, "WorkSourceRateLimitError");
      if (rate._tag === "WorkSourceRateLimitError") assert.equal(rate.retryAfterMs, 4_000);

      const transientProvider = yield* JiraProviderTag.pipe(
        Effect.provide(
          layer([{ status: 302, headers: { location: "http://169.254.169.254/" }, body: "" }])
            .layer,
        ),
      );
      const transient = yield* transientProvider
        .listPage({ connectionRef: "conn", selector: { projectKey: "ENG" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(transient._tag, "WorkSourceTransientError");

      const blockedProvider = yield* JiraProviderTag.pipe(
        Effect.provide(layer([{ body: { issues: [] } }], { baseUrl: "https://127.0.0.1" }).layer),
      );
      const blocked = yield* blockedProvider
        .listPage({ connectionRef: "conn", selector: { projectKey: "ENG" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(blocked._tag, "WorkSourceConfigError");

      // A plain http:// base URL is rejected fast as a config error (the httpClient
      // capability is HTTPS-only) rather than mapped to a transient retry loop.
      const insecureProvider = yield* JiraProviderTag.pipe(
        Effect.provide(
          layer([{ body: { issues: [] } }], { baseUrl: "http://jira.corp.example" }).layer,
        ),
      );
      const insecure = yield* insecureProvider
        .listPage({ connectionRef: "conn", selector: { projectKey: "ENG" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(insecure._tag, "WorkSourceConfigError");
    }),
  );
});
