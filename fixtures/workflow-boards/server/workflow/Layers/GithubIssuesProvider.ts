/**
 * GitHub Issues work-source provider backed by the plugin httpClient capability.
 *
 * externalId = String(issue.number). The GitHub issues endpoint includes pull
 * requests, so listPage filters any item with a pull_request field.
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { GithubSelector } from "../../../contracts/workSource.ts";
import { WorkSourceConnectionStore } from "../Services/WorkSourceConnectionStore.ts";
import { WorkflowHttpClientCapability } from "../Services/WorkflowCapabilities.ts";
import {
  GithubIssuesProvider as GithubIssuesProviderTag,
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

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "t3code-work-source/1.0";

const decodeGithubSelector = Schema.decodeUnknownEffect(GithubSelector);
const decoder = new TextDecoder();
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

const decodeBody = (body: Uint8Array): string => decoder.decode(body);

const parseJson = (body: Uint8Array, message: string) =>
  decodeUnknownJson(decodeBody(body)).pipe(
    Effect.mapError(
      (cause) => new WorkSourceTransientError({ message: `${message}: ${String(cause)}` }),
    ),
  );

function parseNextPageFromLinkHeader(linkHeader: string | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(",")) {
    if (!/rel="next"/u.test(part)) continue;
    const urlMatch = /<([^>]+)>/u.exec(part);
    if (!urlMatch?.[1]) continue;
    try {
      return new URL(urlMatch[1]).searchParams.get("page") ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseRateLimitRetryMs(headers: Readonly<Record<string, string>>, nowMs: number): number {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }

  const resetEpoch = headers["x-ratelimit-reset"];
  if (resetEpoch) {
    const resetMs = Number(resetEpoch) * 1000;
    const delta = resetMs - nowMs;
    return delta > 0 ? delta : 5000;
  }

  return 60_000;
}

interface RawGithubIssue {
  readonly number: number;
  readonly state: string;
  readonly title: string;
  readonly body: string | null;
  readonly html_url: string;
  readonly updated_at: string;
  readonly pull_request?: unknown;
  readonly assignees?: ReadonlyArray<{ readonly login: string }>;
  readonly labels?: ReadonlyArray<{ readonly name: string }>;
}

function mapIssue(raw: RawGithubIssue): ExternalWorkItem {
  const assignees = raw.assignees?.map((a) => a.login);
  const labels = raw.labels?.map((l) => l.name);
  return {
    provider: "github",
    externalId: String(raw.number),
    url: raw.html_url,
    lifecycle: raw.state === "open" ? "open" : "closed",
    version: { updatedAt: raw.updated_at },
    fields: {
      title: raw.title,
      ...(raw.body != null && { description: raw.body }),
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
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": USER_AGENT,
  });

  const classifyStatus = (
    input: { readonly status: number; readonly headers: Readonly<Record<string, string>> },
    connectionRef: string,
    nowMs: number,
    bodyText: string,
    context: string,
  ): Effect.Effect<
    void,
    WorkSourceAuthError | WorkSourceRateLimitError | WorkSourceTransientError
  > => {
    const { status, headers } = input;
    if (
      status === 429 ||
      (status === 403 &&
        (headers["x-ratelimit-remaining"] === "0" || headers["retry-after"] !== undefined))
    ) {
      return Effect.fail(
        new WorkSourceRateLimitError({ retryAfterMs: parseRateLimitRetryMs(headers, nowMs) }),
      );
    }
    if (status === 401 || status === 403) {
      return Effect.fail(new WorkSourceAuthError({ connectionRef }));
    }
    if (status < 200 || status >= 300) {
      return Effect.fail(
        new WorkSourceTransientError({
          message: `GitHub API returned HTTP ${status}${context}: ${bodyText.trim() || "(no body)"}`,
        }),
      );
    }
    return Effect.void;
  };

  const provider: WorkSourceProvider = {
    provider: "github",
    selectorSchema: GithubSelector,

    listPage: (input) =>
      Effect.gen(function* () {
        const selector = yield* decodeGithubSelector(input.selector).pipe(
          Effect.mapError(
            (e) => new WorkSourceConfigError({ message: `Invalid GitHub selector: ${e.message}` }),
          ),
        );

        const pat = yield* connectionStore.getToken(input.connectionRef, "github");
        const now = yield* DateTime.now;
        const nowMs = DateTime.toEpochMillis(now);

        const url = new URL(
          `${GITHUB_API_BASE}/repos/${encodeURIComponent(selector.owner)}/${encodeURIComponent(selector.repo)}/issues`,
        );
        url.searchParams.set("state", selector.state);
        url.searchParams.set("per_page", String(input.pageSize));
        url.searchParams.set("page", String(input.pageToken ?? "1"));
        if (input.since) url.searchParams.set("since", input.since);
        if (selector.labels && selector.labels.length > 0) {
          url.searchParams.set("labels", selector.labels.join(","));
        }
        if (selector.assignee) url.searchParams.set("assignee", selector.assignee);

        const response = yield* http
          .request({ method: "GET", url: url.toString(), headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `GitHub HTTP network error: ${String(cause)}`,
                }),
            ),
          );

        yield* classifyStatus(response, input.connectionRef, nowMs, decodeBody(response.body), "");

        const rawItems = yield* parseJson(response.body, "Failed to parse GitHub JSON response");
        if (!Array.isArray(rawItems)) {
          return yield* new WorkSourceTransientError({
            message: "GitHub /issues response was not an array",
          });
        }

        const items: Array<ExternalWorkItem> = [];
        for (const raw of rawItems as RawGithubIssue[]) {
          if (raw.pull_request !== undefined) continue;
          items.push(mapIssue(raw));
        }

        const nextPageToken = parseNextPageFromLinkHeader(response.headers["link"]);
        return {
          items,
          ...(nextPageToken !== undefined && { nextPageToken }),
        } satisfies WorkSourcePage;
      }),

    getItem: (input) =>
      Effect.gen(function* () {
        const selector = yield* decodeGithubSelector(input.selector).pipe(
          Effect.mapError(
            (e) => new WorkSourceConfigError({ message: `Invalid GitHub selector: ${e.message}` }),
          ),
        );

        const pat = yield* connectionStore.getToken(input.connectionRef, "github");
        const now = yield* DateTime.now;
        const nowMs = DateTime.toEpochMillis(now);
        const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(selector.owner)}/${encodeURIComponent(selector.repo)}/issues/${encodeURIComponent(input.externalId)}`;

        const response = yield* http
          .request({ method: "GET", url, headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `GitHub HTTP network error (getItem): ${String(cause)}`,
                }),
            ),
          );

        if (response.status === 404) return null;
        yield* classifyStatus(
          response,
          input.connectionRef,
          nowMs,
          decodeBody(response.body),
          " (getItem)",
        );

        const rawItem = yield* parseJson(
          response.body,
          "Failed to parse GitHub getItem JSON response",
        );
        if (rawItem === null || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          return yield* new WorkSourceTransientError({
            message: "GitHub /issues/:number response was not an object",
          });
        }

        return mapIssue(rawItem as RawGithubIssue);
      }),

    viewer: ({ connectionRef }) =>
      Effect.gen(function* () {
        const pat = yield* connectionStore.getToken(connectionRef, "github");
        const response = yield* http
          .request({ method: "GET", url: `${GITHUB_API_BASE}/user`, headers: buildHeaders(pat) })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkSourceTransientError({
                  message: `GitHub viewer network error: ${String(cause)}`,
                }),
            ),
          );
        if (response.status !== 200) return null;
        const body = yield* parseJson(response.body, "Failed to parse GitHub viewer JSON").pipe(
          Effect.orElseSucceed(() => ({}) as unknown),
        );
        const login = (body as { readonly login?: unknown }).login;
        return typeof login === "string" && login.length > 0
          ? ({ id: login, aliases: [login] } satisfies Viewer)
          : null;
      }),

    toImportableView: ({ selector, item }): ImportableViewParts => {
      const s = selector as { readonly owner?: string; readonly repo?: string };
      return { displayRef: `#${item.externalId}`, container: `${s.owner ?? "?"}/${s.repo ?? "?"}` };
    },
  };

  return provider;
});

export const GithubIssuesProviderLive: Layer.Layer<
  GithubIssuesProviderTag,
  never,
  WorkflowHttpClientCapability | WorkSourceConnectionStore
> = Layer.effect(GithubIssuesProviderTag, make);
