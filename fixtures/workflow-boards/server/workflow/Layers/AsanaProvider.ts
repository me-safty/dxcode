/**
 * Asana Tasks work-source provider backed by the plugin httpClient capability.
 *
 * externalId = task gid. sectionGid/tagGid are accepted by the selector for
 * future filtering but intentionally not applied in v1.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AsanaSelector } from "../../../contracts/workSource.ts";
import { WorkSourceConnectionStore } from "../Services/WorkSourceConnectionStore.ts";
import { WorkflowHttpClientCapability } from "../Services/WorkflowCapabilities.ts";
import {
  AsanaProvider as AsanaProviderTag,
  WorkSourceAuthError,
  WorkSourceConfigError,
  WorkSourceRateLimitError,
  WorkSourceTransientError,
  type ExternalWorkItem,
  type ImportableViewParts,
  type WorkSourcePage,
  type WorkSourceProvider,
} from "../Services/WorkSourceProvider.ts";

const ASANA_API_BASE = "https://app.asana.com/api/1.0";
const ASANA_TASK_OPT_FIELDS =
  "name,notes,completed,completed_at,assignee.name,tags.name,permalink_url,modified_at,gid";

const decodeAsanaSelector = Schema.decodeUnknownEffect(AsanaSelector);
const decoder = new TextDecoder();
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

const decodeBody = (body: Uint8Array): string => decoder.decode(body);

const parseJson = (body: Uint8Array, message: string) =>
  decodeUnknownJson(decodeBody(body)).pipe(
    Effect.mapError(
      (cause) => new WorkSourceTransientError({ message: `${message}: ${String(cause)}` }),
    ),
  );

function parseAsanaRateLimitRetryMs(headers: Readonly<Record<string, string>>): number {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  return 60_000;
}

interface RawAsanaTask {
  readonly gid: string;
  readonly name: string;
  readonly notes: string | null;
  readonly completed: boolean;
  readonly completed_at: string | null;
  readonly assignee: { readonly name: string } | null;
  readonly tags: ReadonlyArray<{ readonly name: string }> | null;
  readonly permalink_url: string;
  readonly modified_at: string;
}

interface RawAsanaPage {
  readonly data: ReadonlyArray<RawAsanaTask>;
  readonly next_page: {
    readonly offset: string;
    readonly path: string;
    readonly uri: string;
  } | null;
}

function mapTask(raw: RawAsanaTask): ExternalWorkItem {
  const assignees = raw.assignee ? [raw.assignee.name] : undefined;
  const labels = raw.tags && raw.tags.length > 0 ? raw.tags.map((tag) => tag.name) : undefined;
  return {
    provider: "asana",
    externalId: raw.gid,
    url: raw.permalink_url,
    lifecycle: raw.completed ? "closed" : "open",
    version: { updatedAt: raw.modified_at },
    fields: {
      title: raw.name,
      ...(raw.notes != null && raw.notes !== "" && { description: raw.notes }),
      ...(assignees !== undefined && { assignees }),
      ...(labels !== undefined && { labels }),
    },
  };
}

const make = Effect.gen(function* () {
  const http = yield* WorkflowHttpClientCapability;
  const connectionStore = yield* WorkSourceConnectionStore;

  const buildHeaders = (pat: string): Record<string, string> => ({
    authorization: `Bearer ${pat}`,
    accept: "application/json",
  });

  const classifyStatus = (
    status: number,
    headers: Readonly<Record<string, string>>,
    bodyText: string,
    connectionRef: string,
    context: string,
  ): Effect.Effect<
    void,
    WorkSourceAuthError | WorkSourceRateLimitError | WorkSourceTransientError
  > => {
    if (status === 401 || status === 403) {
      return Effect.fail(new WorkSourceAuthError({ connectionRef }));
    }
    if (status === 429) {
      return Effect.fail(
        new WorkSourceRateLimitError({ retryAfterMs: parseAsanaRateLimitRetryMs(headers) }),
      );
    }
    if (status < 200 || status >= 300) {
      return Effect.fail(
        new WorkSourceTransientError({
          message: `Asana API returned HTTP ${status}${context}: ${bodyText.trim() || "(no body)"}`,
        }),
      );
    }
    return Effect.void;
  };

  const provider: WorkSourceProvider = {
    provider: "asana",
    selectorSchema: AsanaSelector,

    listPage: (input) =>
      Effect.gen(function* () {
        const selector = yield* decodeAsanaSelector(input.selector).pipe(
          Effect.mapError(
            (e) => new WorkSourceConfigError({ message: `Invalid Asana selector: ${e.message}` }),
          ),
        );

        if (selector.sectionGid || selector.tagGid) {
          yield* Effect.logWarning(
            "asana source: sectionGid/tagGid filtering is not applied in v1; syncing the entire project",
            { projectGid: selector.projectGid },
          );
        }

        const pat = yield* connectionStore.getToken(input.connectionRef, "asana");
        const url = new URL(`${ASANA_API_BASE}/tasks`);
        url.searchParams.set("project", selector.projectGid);
        url.searchParams.set("opt_fields", ASANA_TASK_OPT_FIELDS);
        url.searchParams.set("limit", String(input.pageSize));
        if (input.since) url.searchParams.set("modified_since", input.since);
        if (input.pageToken) url.searchParams.set("offset", input.pageToken);
        if (selector.includeCompleted === false) url.searchParams.set("completed_since", "now");

        const response = yield* http
          .request({ method: "GET", url: url.toString(), headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `Asana HTTP network error: ${String(cause)}`,
                }),
            ),
          );

        yield* classifyStatus(
          response.status,
          response.headers,
          decodeBody(response.body),
          input.connectionRef,
          "",
        );

        const rawBody = yield* parseJson(response.body, "Failed to parse Asana JSON response");
        if (
          rawBody === null ||
          typeof rawBody !== "object" ||
          !Array.isArray((rawBody as { readonly data?: unknown }).data)
        ) {
          return yield* new WorkSourceTransientError({
            message: "Asana /tasks response did not contain a data array",
          });
        }

        const page = rawBody as RawAsanaPage;
        const nextPageToken = page.next_page?.offset ?? undefined;
        return {
          items: page.data.map(mapTask),
          ...(nextPageToken !== undefined && { nextPageToken }),
        } satisfies WorkSourcePage;
      }),

    getItem: (input) =>
      Effect.gen(function* () {
        const pat = yield* connectionStore.getToken(input.connectionRef, "asana");
        const url = new URL(`${ASANA_API_BASE}/tasks/${encodeURIComponent(input.externalId)}`);
        url.searchParams.set("opt_fields", ASANA_TASK_OPT_FIELDS);

        const response = yield* http
          .request({ method: "GET", url: url.toString(), headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `Asana HTTP network error (getItem): ${String(cause)}`,
                }),
            ),
          );

        if (response.status === 404) return null;
        yield* classifyStatus(
          response.status,
          response.headers,
          decodeBody(response.body),
          input.connectionRef,
          " (getItem)",
        );

        const rawBody = yield* parseJson(
          response.body,
          "Failed to parse Asana getItem JSON response",
        );
        if (
          rawBody === null ||
          typeof rawBody !== "object" ||
          typeof (rawBody as { readonly data?: unknown }).data !== "object" ||
          (rawBody as { readonly data?: unknown }).data === null
        ) {
          return yield* new WorkSourceTransientError({
            message: "Asana /tasks/:gid response did not contain a data object",
          });
        }

        return mapTask((rawBody as { readonly data: RawAsanaTask }).data);
      }),

    viewer: ({ connectionRef }) =>
      Effect.gen(function* () {
        const pat = yield* connectionStore.getToken(connectionRef, "asana");
        const response = yield* http
          .request({ method: "GET", url: `${ASANA_API_BASE}/users/me`, headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `Asana viewer network error: ${String(cause)}`,
                }),
            ),
          );
        if (response.status !== 200) return null;
        const body = yield* parseJson(response.body, "Failed to parse Asana viewer JSON").pipe(
          Effect.orElseSucceed(() => ({}) as unknown),
        );
        const data = (
          body as { readonly data?: { readonly gid?: unknown; readonly name?: unknown } }
        ).data;
        const gid = typeof data?.gid === "string" ? data.gid : null;
        if (gid === null) return null;
        const name = typeof data?.name === "string" ? data.name : "";
        return { id: gid, aliases: name ? [name] : [] };
      }),

    toImportableView: ({ selector, item: _item }): ImportableViewParts => {
      const s = selector as { readonly projectGid?: string };
      return { displayRef: "", container: s.projectGid ?? "Asana" };
    },
  };

  return provider;
});

export const AsanaProviderLive: Layer.Layer<
  AsanaProviderTag,
  never,
  WorkflowHttpClientCapability | WorkSourceConnectionStore
> = Layer.effect(AsanaProviderTag, make);
