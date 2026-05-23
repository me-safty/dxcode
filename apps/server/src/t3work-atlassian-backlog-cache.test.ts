import { assert, it } from "@effect/vitest";
import type {
  AtlassianBacklogBoard,
  AtlassianBacklogSavedFilter,
  AtlassianBacklogSprint,
} from "@t3tools/integrations-atlassian";
import type { ExternalResourceRef, ResourcePage } from "@t3tools/project-context";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import {
  readCachedT3workAtlassianBacklog,
  updateCachedT3workAtlassianBacklogAssignee,
  writeCachedT3workAtlassianBacklog,
  type T3workAtlassianBacklogCapabilities,
  type T3workAtlassianBacklogPayload,
} from "./t3work-atlassian-backlog-cache.ts";
import type { BacklogResourceRef } from "./t3work-atlassian-backlog-cacheShared.ts";

const backlogCacheLayer = it.layer(SqlitePersistenceMemory);

function createIssue(overrides?: Partial<ExternalResourceRef>): ExternalResourceRef {
  return {
    provider: "atlassian",
    kind: "issue",
    id: "10001",
    displayId: "PROJ-1",
    title: "Plan sprint",
    status: "Todo",
    assignee: "Alex",
    updatedAt: "2026-05-21T12:00:00.000Z",
    ...overrides,
  };
}

function createBacklogPayload(
  overrides?: Partial<T3workAtlassianBacklogPayload>,
): T3workAtlassianBacklogPayload {
  return {
    page: {
      items: [createIssue()],
      totalCount: 1,
    } satisfies ResourcePage,
    capabilities: {
      canCreateSubtasks: true,
    } satisfies T3workAtlassianBacklogCapabilities,
    boards: [{ id: "board-1", name: "Core board" }] satisfies ReadonlyArray<AtlassianBacklogBoard>,
    sprints: [{ id: "sprint-1", name: "Sprint 1" }] satisfies ReadonlyArray<AtlassianBacklogSprint>,
    savedFilters: [
      { id: "filter-1", name: "Only mine", jql: "assignee = currentUser()" },
    ] satisfies ReadonlyArray<AtlassianBacklogSavedFilter>,
    selectedBoardId: "board-1",
    selectedSprintId: "sprint-1",
    ...overrides,
  };
}

backlogCacheLayer("t3work Atlassian backlog cache", (it) => {
  it.effect("persists raw issue rows and resolves both request and resolved selections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* writeCachedT3workAtlassianBacklog({
        provider: "atlassian",
        accountId: "account-1",
        externalProjectId: "project-1",
        requestSelection: {},
        response: createBacklogPayload(),
      });

      const requestCached = yield* readCachedT3workAtlassianBacklog({
        provider: "atlassian",
        accountId: "account-1",
        externalProjectId: "project-1",
      });
      assert.deepStrictEqual(requestCached?.response.selectedBoardId, "board-1");
      assert.deepStrictEqual(requestCached?.response.page.items[0]?.displayId, "PROJ-1");

      const resolvedCached = yield* readCachedT3workAtlassianBacklog({
        provider: "atlassian",
        accountId: "account-1",
        externalProjectId: "project-1",
        selection: { boardId: "board-1", sprintId: "sprint-1" },
      });
      assert.deepStrictEqual(resolvedCached?.response.page.totalCount, 1);

      const issueRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM t3work_atlassian_backlog_issues
      `;
      assert.deepStrictEqual(issueRows[0]?.count, 1);
    }),
  );

  it.effect("patches cached issue rows so cached views stay usable offline after mutations", () =>
    Effect.gen(function* () {
      yield* writeCachedT3workAtlassianBacklog({
        provider: "atlassian",
        accountId: "account-1",
        externalProjectId: "project-1",
        requestSelection: { boardId: "board-1" },
        response: createBacklogPayload(),
      });

      yield* updateCachedT3workAtlassianBacklogAssignee({
        provider: "atlassian",
        accountId: "account-1",
        issueIdOrKey: "PROJ-1",
        assigneeAccountId: "account-2",
        assigneeDisplayName: "Blair",
      });

      const cached = yield* readCachedT3workAtlassianBacklog({
        provider: "atlassian",
        accountId: "account-1",
        externalProjectId: "project-1",
        selection: { boardId: "board-1" },
      });
      const cachedItem = cached?.response.page.items[0] as BacklogResourceRef | undefined;

      assert.deepStrictEqual(cachedItem?.assignee, "Blair");
      assert.deepStrictEqual(cachedItem?.assigneeAccountId, "account-2");
    }),
  );

  it.effect(
    "reuses the newest cached project view when the default selection has no exact cache row",
    () =>
      Effect.gen(function* () {
        yield* writeCachedT3workAtlassianBacklog({
          provider: "atlassian",
          accountId: "account-1",
          externalProjectId: "project-1",
          requestSelection: { boardId: "board-1", sprintId: "sprint-1" },
          response: createBacklogPayload(),
        });

        const cached = yield* readCachedT3workAtlassianBacklog({
          provider: "atlassian",
          accountId: "account-1",
          externalProjectId: "project-1",
        });

        assert.deepStrictEqual(cached?.response.selectedBoardId, "board-1");
        assert.deepStrictEqual(cached?.response.selectedSprintId, "sprint-1");
        assert.deepStrictEqual(cached?.response.page.items[0]?.displayId, "PROJ-1");
      }),
  );
});
