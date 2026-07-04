/**
 * Jira work-source provider backed by the plugin httpClient capability.
 *
 * Supports Jira Cloud Basic auth and Server/Data Center Bearer auth. Requests
 * use /rest/api/2 so Cloud descriptions remain plain strings.
 */
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { JiraSelector } from "../../../contracts/workSource.ts";
import { isBlockedHost } from "../blockedHost.ts";
import { WorkSourceConnectionStore } from "../Services/WorkSourceConnectionStore.ts";
import { WorkflowHttpClientCapability } from "../Services/WorkflowCapabilities.ts";
import {
  JiraProvider as JiraProviderTag,
  WorkSourceAuthError,
  WorkSourceConfigError,
  WorkSourceRateLimitError,
  WorkSourceTransientError,
  type ExternalWorkItem,
  type ImportableViewParts,
  type Viewer,
  type WorkSourcePage,
  type WorkSourceProvider,
} from "../Services/WorkSourceProvider.ts";

const USER_AGENT = "t3code-work-source/1.0";
const JIRA_MAX_RESULTS_CAP = 100;
const ISSUE_FIELDS = "summary,description,status,assignee,labels,updated";

const decoder = new TextDecoder();
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

const decodeBody = (body: Uint8Array): string => decoder.decode(body);

const parseJson = (body: Uint8Array, message: string) =>
  decodeUnknownJson(decodeBody(body)).pipe(
    Effect.mapError(
      (cause) => new WorkSourceTransientError({ message: `${message}: ${String(cause)}` }),
    ),
  );

const trimUrl = (url: string) => url.replace(/\/+$/u, "");

function parseJiraRateLimitRetryMs(headers: Readonly<Record<string, string>>): number {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  return 60_000;
}

interface ConnAuth {
  readonly token: string;
  readonly authMode: "pat" | "basic" | "bearer";
  readonly baseUrl: string | null;
  readonly email: string | null;
}

function requireBaseUrl(auth: ConnAuth): Effect.Effect<string, WorkSourceConfigError> {
  const base = auth.baseUrl?.trim();
  if (!base) {
    return Effect.fail(
      new WorkSourceConfigError({ message: "Jira connection is missing a base URL" }),
    );
  }

  return Effect.try({
    try: () => new URL(base),
    catch: () => new WorkSourceConfigError({ message: "Jira base URL is not a valid URL" }),
  }).pipe(
    Effect.flatMap((parsed) =>
      // The httpClient capability is HTTPS-only; reject plain http:// here with a
      // config error so a mis-typed base URL fails fast instead of being mapped to
      // a transient error and retried forever against an unreachable target.
      parsed.protocol !== "https:"
        ? Effect.fail(new WorkSourceConfigError({ message: "Jira base URL must use https" }))
        : isBlockedHost(parsed.hostname)
          ? Effect.fail(new WorkSourceConfigError({ message: "Jira base URL host is not allowed" }))
          : Effect.succeed(trimUrl(base)),
    ),
  );
}

function buildHeaders(
  auth: ConnAuth,
): Effect.Effect<Record<string, string>, WorkSourceConfigError> {
  const common = { accept: "application/json", "user-agent": USER_AGENT };
  if (auth.authMode === "basic") {
    if (!auth.email) {
      return Effect.fail(
        new WorkSourceConfigError({
          message: "Jira Cloud connection is missing an email for Basic auth",
        }),
      );
    }
    const encoded = Encoding.encodeBase64(`${auth.email}:${auth.token}`);
    return Effect.succeed({ ...common, authorization: `Basic ${encoded}` });
  }
  return Effect.succeed({ ...common, authorization: `Bearer ${auth.token}` });
}

function buildJql(
  selector: { readonly projectKey: string; readonly jql?: string | undefined },
  since?: string,
): string {
  const clauses: Array<string> = [`project = "${selector.projectKey.replace(/"/gu, '\\"')}"`];
  if (selector.jql && selector.jql.trim().length > 0) clauses.push(`(${selector.jql.trim()})`);
  if (since) {
    const jiraDate = since.slice(0, 16).replace("T", " ");
    clauses.push(`updated >= "${jiraDate}"`);
  }
  return `${clauses.join(" AND ")} ORDER BY updated ASC`;
}

interface RawJiraFields {
  readonly summary: string;
  readonly description?: string | null;
  readonly status?: { readonly statusCategory?: { readonly key?: string } | null } | null;
  readonly assignee?: {
    readonly displayName?: string | null;
    readonly name?: string | null;
  } | null;
  readonly labels?: ReadonlyArray<string> | null;
  readonly updated?: string | null;
}

interface RawJiraIssue {
  readonly key: string;
  readonly fields: RawJiraFields;
}

interface RawJiraSearch {
  readonly issues?: ReadonlyArray<RawJiraIssue> | null;
  readonly startAt?: number;
  readonly total?: number;
}

function mapIssue(raw: RawJiraIssue, baseUrl: string): ExternalWorkItem {
  const statusKey = raw.fields.status?.statusCategory?.key;
  const assigneeName = raw.fields.assignee?.displayName ?? raw.fields.assignee?.name;
  const labels =
    raw.fields.labels && raw.fields.labels.length > 0 ? raw.fields.labels.slice() : undefined;
  return {
    provider: "jira",
    externalId: raw.key,
    url: `${baseUrl}/browse/${raw.key}`,
    lifecycle: statusKey === "done" ? "closed" : "open",
    version: raw.fields.updated ? { updatedAt: raw.fields.updated } : {},
    fields: {
      title: raw.fields.summary,
      ...(raw.fields.description != null &&
        raw.fields.description !== "" && { description: raw.fields.description }),
      ...(assigneeName != null && { assignees: [assigneeName] }),
      ...(labels !== undefined && { labels }),
    },
  };
}

const decodeJiraSelector = Schema.decodeUnknownEffect(JiraSelector);

const make = Effect.gen(function* () {
  const http = yield* WorkflowHttpClientCapability;
  const connectionStore = yield* WorkSourceConnectionStore;

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
    if (status === 429) {
      return Effect.fail(
        new WorkSourceRateLimitError({ retryAfterMs: parseJiraRateLimitRetryMs(headers) }),
      );
    }
    if (status === 401 || status === 403) {
      return Effect.fail(new WorkSourceAuthError({ connectionRef }));
    }
    if (status < 200 || status >= 300) {
      return Effect.fail(
        new WorkSourceTransientError({
          message: `Jira API returned HTTP ${status}${context}: ${bodyText.trim() || "(no body)"}`,
        }),
      );
    }
    return Effect.void;
  };

  const provider: WorkSourceProvider = {
    provider: "jira",
    selectorSchema: JiraSelector,

    listPage: (input) =>
      Effect.gen(function* () {
        const selector = yield* decodeJiraSelector(input.selector).pipe(
          Effect.mapError(
            (e) => new WorkSourceConfigError({ message: `Invalid Jira selector: ${e.message}` }),
          ),
        );
        const auth = yield* connectionStore.getConnectionAuth(input.connectionRef, "jira");
        const baseUrl = yield* requireBaseUrl(auth);
        const headers = yield* buildHeaders(auth);

        const startAt = Number(input.pageToken ?? "0");
        const effectiveStartAt = Number.isNaN(startAt) ? 0 : startAt;
        const url = new URL(`${baseUrl}/rest/api/2/search`);
        url.searchParams.set("jql", buildJql(selector, input.since));
        url.searchParams.set("startAt", String(effectiveStartAt));
        url.searchParams.set("maxResults", String(Math.min(input.pageSize, JIRA_MAX_RESULTS_CAP)));
        url.searchParams.set("fields", ISSUE_FIELDS);

        const response = yield* http.request({ method: "GET", url: url.toString(), headers }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkSourceTransientError({
                message: `Jira HTTP network error: ${String(cause)}`,
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

        const raw = yield* parseJson(response.body, "Failed to parse Jira JSON");
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          return yield* new WorkSourceTransientError({
            message: "Jira /search response was not an object",
          });
        }

        const search = raw as RawJiraSearch;
        const rawIssues = Array.isArray(search.issues) ? search.issues : [];
        const items = rawIssues.map((issue) => mapIssue(issue, baseUrl));
        const total =
          typeof search.total === "number" ? search.total : effectiveStartAt + items.length;
        const nextStart = effectiveStartAt + items.length;
        const hasMore = items.length > 0 && nextStart < total;

        return {
          items,
          ...(hasMore && { nextPageToken: String(nextStart) }),
        } satisfies WorkSourcePage;
      }),

    getItem: (input) =>
      Effect.gen(function* () {
        const auth = yield* connectionStore.getConnectionAuth(input.connectionRef, "jira");
        const baseUrl = yield* requireBaseUrl(auth);
        const headers = yield* buildHeaders(auth);
        const url = new URL(`${baseUrl}/rest/api/2/issue/${encodeURIComponent(input.externalId)}`);
        url.searchParams.set("fields", ISSUE_FIELDS);

        const response = yield* http.request({ method: "GET", url: url.toString(), headers }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkSourceTransientError({
                message: `Jira HTTP network error (getItem): ${String(cause)}`,
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

        const raw = yield* parseJson(response.body, "Failed to parse Jira getItem JSON");
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          return yield* new WorkSourceTransientError({
            message: "Jira /issue response was not an object",
          });
        }
        const candidate = raw as RawJiraIssue;
        if (
          typeof candidate.key !== "string" ||
          typeof candidate.fields !== "object" ||
          candidate.fields === null
        ) {
          return yield* new WorkSourceTransientError({
            message: "Jira /issue response missing key or fields",
          });
        }
        return mapIssue(candidate, baseUrl);
      }),

    viewer: ({ connectionRef }) =>
      Effect.gen(function* () {
        const auth = yield* connectionStore.getConnectionAuth(connectionRef, "jira");
        const baseUrl = yield* requireBaseUrl(auth);
        const headers = yield* buildHeaders(auth);
        const response = yield* http
          .request({ method: "GET", url: `${baseUrl}/rest/api/2/myself`, headers })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `Jira viewer network error: ${String(cause)}`,
                }),
            ),
          );
        if (response.status !== 200) return null;
        const body = yield* parseJson(response.body, "Failed to parse Jira viewer JSON").pipe(
          Effect.orElseSucceed(() => ({}) as unknown),
        );
        const raw = body as {
          readonly accountId?: unknown;
          readonly name?: unknown;
          readonly key?: unknown;
          readonly displayName?: unknown;
          readonly emailAddress?: unknown;
        };
        const asStr = (value: unknown) =>
          typeof value === "string" && value.length > 0 ? value : undefined;
        const id = asStr(raw.accountId) ?? asStr(raw.name) ?? asStr(raw.key);
        if (id === undefined) return null;
        const aliases = [
          raw.accountId,
          raw.displayName,
          raw.name,
          raw.key,
          raw.emailAddress,
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        return { id, aliases } satisfies Viewer;
      }),

    toImportableView: ({ selector, item }): ImportableViewParts => {
      const s = selector as { readonly projectKey?: string };
      return { displayRef: item.externalId, container: s.projectKey ?? "?" };
    },
  };

  return provider;
});

export const JiraProviderLive: Layer.Layer<
  JiraProviderTag,
  never,
  WorkflowHttpClientCapability | WorkSourceConnectionStore
> = Layer.effect(JiraProviderTag, make);
