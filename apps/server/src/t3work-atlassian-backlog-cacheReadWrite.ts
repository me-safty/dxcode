import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "./persistence/Errors.ts";
import {
  readCachedBacklogIssueRows,
  readCachedBacklogViewRow,
  serializeBacklogCacheJson,
} from "./t3work-atlassian-backlog-cacheQueries.ts";
import {
  buildPersistedSelectionKeys,
  fingerprintBacklogPayload,
  materializeBacklogPayload,
  type T3workAtlassianBacklogPayload,
  type T3workBacklogCacheIdentity,
  type T3workBacklogSelectionInput,
  type T3workCachedAtlassianBacklogRecord,
} from "./t3work-atlassian-backlog-cacheShared.ts";
import { ensureBacklogCacheTables } from "./t3work-atlassian-backlog-cacheTables.ts";

export const readCachedT3workAtlassianBacklog = Effect.fn("t3work.atlassianBacklogCache.read")(
  function* (
    input: T3workBacklogCacheIdentity & {
      readonly selection?: T3workBacklogSelectionInput;
    },
  ) {
    return yield* Effect.gen(function* () {
      yield* ensureBacklogCacheTables();
      const resolvedRow = yield* readCachedBacklogViewRow(input);
      if (!resolvedRow) {
        return null;
      }

      const issueRows = yield* readCachedBacklogIssueRows(input);

      const response = materializeBacklogPayload({ row: resolvedRow, issueRows });
      if (!response) {
        return null;
      }

      return {
        response,
        updatedAt: resolvedRow.updatedAt,
        fingerprint: fingerprintBacklogPayload(response),
      } satisfies T3workCachedAtlassianBacklogRecord;
    }).pipe(Effect.mapError(toPersistenceSqlError("t3work.atlassianBacklogCache.read")));
  },
);

export const writeCachedT3workAtlassianBacklog = Effect.fn("t3work.atlassianBacklogCache.write")(
  function* (
    input: T3workBacklogCacheIdentity & {
      readonly requestSelection?: T3workBacklogSelectionInput;
      readonly response: T3workAtlassianBacklogPayload;
      readonly updatedAt?: number;
      readonly replaceProjectCache?: boolean;
    },
  ) {
    return yield* Effect.gen(function* () {
      yield* ensureBacklogCacheTables();
      const sql = yield* SqlClient.SqlClient;
      const updatedAt = input.updatedAt ?? (yield* Clock.currentTimeMillis);
      const selectionKeys = buildPersistedSelectionKeys({
        response: input.response,
        ...(input.requestSelection ? { requestSelection: input.requestSelection } : {}),
      });

      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (input.replaceProjectCache) {
            yield* sql`
            DELETE FROM t3work_atlassian_backlog_views
            WHERE provider = ${input.provider}
              AND account_id = ${input.accountId}
              AND external_project_id = ${input.externalProjectId}
          `;
            yield* sql`
            DELETE FROM t3work_atlassian_backlog_issues
            WHERE provider = ${input.provider}
              AND account_id = ${input.accountId}
              AND external_project_id = ${input.externalProjectId}
          `;
          }

          for (const item of input.response.page.items) {
            yield* sql`
            INSERT INTO t3work_atlassian_backlog_issues (
              provider,
              account_id,
              external_project_id,
              issue_id,
              issue_key,
              resource_json,
              updated_at
            )
            VALUES (
              ${input.provider},
              ${input.accountId},
              ${input.externalProjectId},
              ${item.id},
              ${item.displayId ?? null},
              ${serializeBacklogCacheJson(item)},
              ${updatedAt}
            )
            ON CONFLICT (provider, account_id, external_project_id, issue_id)
            DO UPDATE SET
              issue_key = excluded.issue_key,
              resource_json = excluded.resource_json,
              updated_at = excluded.updated_at
          `;
          }

          for (const selectionKey of selectionKeys) {
            yield* sql`
            INSERT INTO t3work_atlassian_backlog_views (
              provider,
              account_id,
              external_project_id,
              selection_key,
              selected_board_id,
              selected_sprint_id,
              selected_filter_id,
              issue_ids_json,
              boards_json,
              sprints_json,
              saved_filters_json,
              capabilities_json,
              page_next_cursor,
              page_total_count,
              updated_at
            )
            VALUES (
              ${input.provider},
              ${input.accountId},
              ${input.externalProjectId},
              ${selectionKey},
              ${input.response.selectedBoardId ?? null},
              ${input.response.selectedSprintId ?? null},
              ${input.response.selectedFilterId ?? null},
              ${serializeBacklogCacheJson(input.response.page.items.map((item) => item.id))},
              ${serializeBacklogCacheJson(input.response.boards)},
              ${serializeBacklogCacheJson(input.response.sprints)},
              ${serializeBacklogCacheJson(input.response.savedFilters)},
              ${serializeBacklogCacheJson(input.response.capabilities)},
              ${input.response.page.nextCursor ?? null},
              ${input.response.page.totalCount ?? null},
              ${updatedAt}
            )
            ON CONFLICT (provider, account_id, external_project_id, selection_key)
            DO UPDATE SET
              selected_board_id = excluded.selected_board_id,
              selected_sprint_id = excluded.selected_sprint_id,
              selected_filter_id = excluded.selected_filter_id,
              issue_ids_json = excluded.issue_ids_json,
              boards_json = excluded.boards_json,
              sprints_json = excluded.sprints_json,
              saved_filters_json = excluded.saved_filters_json,
              capabilities_json = excluded.capabilities_json,
              page_next_cursor = excluded.page_next_cursor,
              page_total_count = excluded.page_total_count,
              updated_at = excluded.updated_at
          `;
          }
        }),
      );

      return {
        updatedAt,
        fingerprint: fingerprintBacklogPayload(input.response),
      };
    }).pipe(Effect.mapError(toPersistenceSqlError("t3work.atlassianBacklogCache.write")));
  },
);
