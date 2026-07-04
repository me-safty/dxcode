import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GithubIssuesProvider as GithubIssuesProviderTag } from "../Services/WorkSourceProvider.ts";
import { GithubIssuesProviderLive } from "./GithubIssuesProvider.ts";
import { makeConnectionStoreLayer, makeHttpClientLayer } from "./WorkSourceProvider.testUtils.ts";

const issueOpen = {
  number: 1,
  state: "open",
  title: "Bug: something broken",
  body: "Describe the bug",
  html_url: "https://github.com/acme/widgets/issues/1",
  updated_at: "2024-01-01T00:00:00Z",
  assignees: [{ login: "alice" }],
  labels: [{ name: "bug" }, { name: "backend" }],
};

const pullRequest = {
  number: 2,
  state: "open",
  title: "PR: add feature",
  body: null,
  html_url: "https://github.com/acme/widgets/pull/2",
  updated_at: "2024-01-02T00:00:00Z",
  assignees: [],
  labels: [],
  pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/2" },
};

const issueClosed = {
  number: 3,
  state: "closed",
  title: "Fixed already",
  body: null,
  html_url: "https://github.com/acme/widgets/issues/3",
  updated_at: "2024-01-03T00:00:00Z",
  assignees: [],
  labels: [{ name: "fixed" }],
};

const layer = (responses: Parameters<typeof makeHttpClientLayer>[0], token = "github-pat") => {
  const http = makeHttpClientLayer(responses);
  return {
    request: http.request,
    layer: GithubIssuesProviderLive.pipe(
      Layer.provide(http.layer),
      Layer.provide(makeConnectionStoreLayer({ token, expectedProvider: "github" })),
    ),
  };
};

describe("GithubIssuesProviderLive", () => {
  it.effect(
    "maps issues, skips pull requests, sends auth headers, and parses Link pagination",
    () => {
      const link =
        '<https://api.github.com/repos/acme/widgets/issues?page=2>; rel="next", <https://api.github.com/repos/acme/widgets/issues?page=5>; rel="last"';
      const { request, layer: live } = layer([
        { body: [issueOpen, pullRequest, issueClosed], headers: { Link: link } },
      ]);

      return Effect.gen(function* () {
        const provider = yield* GithubIssuesProviderTag;
        const page = yield* provider.listPage({
          connectionRef: "conn",
          selector: { owner: "acme", repo: "widgets", labels: ["bug"], state: "all" },
          since: "2024-01-01T00:00:00Z",
          pageSize: 50,
        });

        expect(page.items.map((item) => item.externalId)).toEqual(["1", "3"]);
        expect(page.nextPageToken).toBe("2");
        expect(page.items[0]!.fields).toEqual({
          title: "Bug: something broken",
          description: "Describe the bug",
          assignees: ["alice"],
          labels: ["bug", "backend"],
        });
        expect(page.items[0]!.lifecycle).toBe("open");
        expect(page.items[1]!.lifecycle).toBe("closed");

        const input = request.mock.calls[0]![0];
        const url = new URL(input.url);
        expect(url.origin + url.pathname).toBe("https://api.github.com/repos/acme/widgets/issues");
        expect(url.searchParams.get("state")).toBe("all");
        expect(url.searchParams.get("labels")).toBe("bug");
        expect(url.searchParams.get("since")).toBe("2024-01-01T00:00:00Z");
        expect(input.headers?.authorization).toBe("Bearer github-pat");
        expect(input.headers?.accept).toBe("application/vnd.github+json");
        expect(input.headers?.["x-github-api-version"]).toBe("2022-11-28");
      }).pipe(Effect.provide(live));
    },
  );

  it.effect("getItem returns null on 404 and a typed failure on other provider errors", () => {
    const { layer: deleted } = layer([{ status: 404, body: { message: "not found" } }]);
    const { layer: failed } = layer([{ status: 500, body: { message: "boom" } }]);

    return Effect.gen(function* () {
      const deletedProvider = yield* GithubIssuesProviderTag.pipe(Effect.provide(deleted));
      const result = yield* deletedProvider.getItem({
        connectionRef: "conn",
        selector: { owner: "acme", repo: "widgets" },
        externalId: "9",
      });
      expect(result).toBeNull();

      const failedProvider = yield* GithubIssuesProviderTag.pipe(Effect.provide(failed));
      const failure = yield* failedProvider
        .getItem({
          connectionRef: "conn",
          selector: { owner: "acme", repo: "widgets" },
          externalId: "9",
        })
        .pipe(Effect.flip);
      expect(failure._tag).toBe("WorkSourceTransientError");
    });
  });

  it.effect("classifies auth, rate-limit, and transient responses", () => {
    const auth = layer([{ status: 403, body: { message: "forbidden" } }]).layer;
    const limited = layer([
      {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "retry-after": "2" },
        body: { message: "rate limit" },
      },
    ]).layer;
    const transient = layer([{ status: 502, body: { message: "bad gateway" } }]).layer;
    // A 403 with rate-limit headers present but NON-zero remaining and no retry-after
    // is a genuine permission error (e.g. SSO/scope) → auth, not transient. Classifying
    // it transient would retry a permanently-doomed sync forever.
    const permission403 = layer([
      {
        status: 403,
        headers: { "x-ratelimit-remaining": "4999" },
        body: { message: "resource not accessible by integration" },
      },
    ]).layer;

    const call = (live: Layer.Layer<GithubIssuesProviderTag>) =>
      Effect.gen(function* () {
        const provider = yield* GithubIssuesProviderTag;
        return yield* provider.listPage({
          connectionRef: "conn",
          selector: { owner: "acme", repo: "widgets" },
          pageSize: 10,
        });
      }).pipe(Effect.provide(live));

    return Effect.gen(function* () {
      const authFailure = yield* call(auth).pipe(Effect.flip);
      assert.equal(authFailure._tag, "WorkSourceAuthError");
      const rateFailure = yield* call(limited).pipe(Effect.flip);
      assert.equal(rateFailure._tag, "WorkSourceRateLimitError");
      if (rateFailure._tag === "WorkSourceRateLimitError") {
        assert.equal(rateFailure.retryAfterMs, 2_000);
      }
      const transientFailure = yield* call(transient).pipe(Effect.flip);
      assert.equal(transientFailure._tag, "WorkSourceTransientError");
      const permissionFailure = yield* call(permission403).pipe(Effect.flip);
      assert.equal(permissionFailure._tag, "WorkSourceAuthError");
    });
  });
});
