import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AsanaProvider as AsanaProviderTag } from "../Services/WorkSourceProvider.ts";
import { AsanaProviderLive } from "./AsanaProvider.ts";
import { makeConnectionStoreLayer, makeHttpClientLayer } from "./WorkSourceProvider.testUtils.ts";

const taskOpen = {
  gid: "task-1",
  name: "Fix the bug",
  notes: "Detailed description",
  completed: false,
  completed_at: null,
  assignee: { name: "Alice" },
  tags: [{ name: "urgent" }, { name: "backend" }],
  permalink_url: "https://app.asana.com/0/project/task-1",
  modified_at: "2024-02-01T10:00:00.000Z",
};

const taskCompleted = {
  gid: "task-2",
  name: "Write docs",
  notes: null,
  completed: true,
  completed_at: "2024-02-02T12:00:00.000Z",
  assignee: null,
  tags: [],
  permalink_url: "https://app.asana.com/0/project/task-2",
  modified_at: "2024-02-02T12:00:00.000Z",
};

const page = (tasks: ReadonlyArray<unknown>, offset?: string) => ({
  data: tasks,
  next_page: offset
    ? { offset, path: `/tasks?offset=${offset}`, uri: "https://app.asana.com/api/1.0/tasks" }
    : null,
});

const layer = (responses: Parameters<typeof makeHttpClientLayer>[0], token = "asana-pat") => {
  const http = makeHttpClientLayer(responses);
  return {
    request: http.request,
    layer: AsanaProviderLive.pipe(
      Layer.provide(http.layer),
      Layer.provide(makeConnectionStoreLayer({ token, expectedProvider: "asana" })),
    ),
  };
};

describe("AsanaProviderLive", () => {
  it.effect(
    "maps tasks, preserves accepted section/tag selectors, paginates, and sends auth",
    () => {
      const { request, layer: live } = layer([
        { body: page([taskOpen, taskCompleted], "NEXT_OFFSET") },
      ]);

      return Effect.gen(function* () {
        const provider = yield* AsanaProviderTag;
        const result = yield* provider.listPage({
          connectionRef: "conn",
          selector: {
            projectGid: "project-1",
            sectionGid: "section-1",
            tagGid: "tag-1",
            includeCompleted: false,
          },
          pageToken: "OFFSET",
          since: "2024-02-01T00:00:00.000Z",
          pageSize: 25,
        });

        expect(result.nextPageToken).toBe("NEXT_OFFSET");
        expect(result.items.map((item) => [item.externalId, item.lifecycle])).toEqual([
          ["task-1", "open"],
          ["task-2", "closed"],
        ]);
        expect(result.items[0]!.fields).toEqual({
          title: "Fix the bug",
          description: "Detailed description",
          assignees: ["Alice"],
          labels: ["urgent", "backend"],
        });

        const input = request.mock.calls[0]![0];
        const url = new URL(input.url);
        expect(url.origin + url.pathname).toBe("https://app.asana.com/api/1.0/tasks");
        expect(url.searchParams.get("project")).toBe("project-1");
        expect(url.searchParams.get("offset")).toBe("OFFSET");
        expect(url.searchParams.get("modified_since")).toBe("2024-02-01T00:00:00.000Z");
        expect(url.searchParams.get("completed_since")).toBe("now");
        expect(input.headers?.authorization).toBe("Bearer asana-pat");
      }).pipe(Effect.provide(live));
    },
  );

  it.effect("getItem returns null on 404 and maps an existing task", () => {
    const { layer: deleted } = layer([{ status: 404, body: { errors: [] } }]);
    const { layer: existing } = layer([{ body: { data: taskOpen } }]);

    return Effect.gen(function* () {
      const deletedProvider = yield* AsanaProviderTag.pipe(Effect.provide(deleted));
      const deletedResult = yield* deletedProvider.getItem({
        connectionRef: "conn",
        selector: { projectGid: "project-1" },
        externalId: "missing",
      });
      expect(deletedResult).toBeNull();

      const existingProvider = yield* AsanaProviderTag.pipe(Effect.provide(existing));
      const item = yield* existingProvider.getItem({
        connectionRef: "conn",
        selector: { projectGid: "project-1" },
        externalId: "task-1",
      });
      expect(item?.externalId).toBe("task-1");
      expect(item?.fields.assignees).toEqual(["Alice"]);
    });
  });

  it.effect("classifies auth, rate-limit, and transient responses", () =>
    Effect.gen(function* () {
      for (const status of [401, 403] as const) {
        const live = layer([{ status, body: { errors: [{ message: "no" }] } }]).layer;
        const provider = yield* AsanaProviderTag.pipe(Effect.provide(live));
        const failure = yield* provider
          .listPage({ connectionRef: "conn", selector: { projectGid: "project-1" }, pageSize: 10 })
          .pipe(Effect.flip);
        assert.equal(failure._tag, "WorkSourceAuthError");
      }

      const rateProvider = yield* AsanaProviderTag.pipe(
        Effect.provide(
          layer([{ status: 429, headers: { "Retry-After": "3" }, body: { errors: [] } }]).layer,
        ),
      );
      const rateFailure = yield* rateProvider
        .listPage({ connectionRef: "conn", selector: { projectGid: "project-1" }, pageSize: 10 })
        .pipe(Effect.flip);
      assert.equal(rateFailure._tag, "WorkSourceRateLimitError");
      if (rateFailure._tag === "WorkSourceRateLimitError") {
        assert.equal(rateFailure.retryAfterMs, 3_000);
      }

      const transientProvider = yield* AsanaProviderTag.pipe(
        Effect.provide(layer([{ status: 503, body: "unavailable" }]).layer),
      );
      const transient = yield* transientProvider
        .getItem({ connectionRef: "conn", selector: { projectGid: "project-1" }, externalId: "x" })
        .pipe(Effect.flip);
      assert.equal(transient._tag, "WorkSourceTransientError");
    }),
  );
});
