import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { JiraService } from "../Services/JiraService.ts";
import { JiraApiError, JiraConfigError } from "../Errors.ts";
import type { JiraTicket } from "@t3tools/contracts";

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? "https://mediafly.atlassian.net";

function readNetrcCredentials(host: string): { login: string; password: string } | null {
  try {
    const netrcPath = path.join(os.homedir(), ".netrc");
    const content = fs.readFileSync(netrcPath, "utf-8");
    const machineRegex = new RegExp(
      `machine\\s+${host.replace(/\./g, "\\.")}\\s+login\\s+(\\S+)\\s+password\\s+(\\S+)`,
    );
    const match = content.match(machineRegex);
    if (match) return { login: match[1]!, password: match[2]! };
    return null;
  } catch {
    return null;
  }
}

function getAuthHeader(): Effect.Effect<string, JiraConfigError> {
  return Effect.sync(() => {
    const url = new URL(JIRA_BASE_URL);
    const creds = readNetrcCredentials(url.hostname);
    if (!creds) {
      return Effect.fail(
        new JiraConfigError({ message: `No credentials found in ~/.netrc for ${url.hostname}` }),
      );
    }
    return Effect.succeed(
      `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString("base64")}`,
    );
  }).pipe(Effect.flatten);
}

function mapIssueToTicket(issue: any): JiraTicket {
  const fields = issue.fields ?? {};
  return {
    key: issue.key,
    summary: fields.summary ?? "Untitled",
    status: fields.status?.name ?? "Unknown",
    priority: fields.priority?.name ?? "Medium",
    issueType: fields.issuetype?.name ?? "Task",
    assignee: fields.assignee?.displayName ?? null,
    reporter: fields.reporter?.displayName ?? null,
    description: extractTextFromAdf(fields.description),
    components: (fields.components ?? []).map((c: any) => c.name),
    labels: fields.labels ?? [],
    parentKey: fields.parent?.key ?? null,
    url: `${JIRA_BASE_URL}/browse/${issue.key}`,
    created: fields.created ?? new Date().toISOString(),
    updated: fields.updated ?? new Date().toISOString(),
  } as JiraTicket;
}

function extractTextFromAdf(adf: any): string | null {
  if (!adf || typeof adf !== "object") return null;
  if (adf.type === "text") return adf.text ?? "";
  if (Array.isArray(adf.content)) {
    return adf.content.map(extractTextFromAdf).filter(Boolean).join("");
  }
  return null;
}

export const JiraServiceLive = Layer.effect(
  JiraService,
  Effect.gen(function* () {
    return JiraService.of({
      listTickets: ({ assignee, status, maxResults }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const jql = [
            assignee ? `assignee = "${assignee}"` : "assignee = currentUser()",
            "resolution = Unresolved",
            status ? `status = "${status}"` : undefined,
          ]
            .filter(Boolean)
            .join(" AND ");
          const params = new URLSearchParams({
            jql,
            maxResults: String(maxResults ?? 50),
          });
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/search/jql?${params}`, {
                headers: { Authorization: auth, Accept: "application/json" },
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}` }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `Jira API error: ${response.status}`,
              statusCode: response.status,
            });
          }
          const data = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{ issues: any[] }>,
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}` }),
          });
          return (data.issues ?? []).map(mapIssueToTicket);
        }),

      getTicket: ({ ticketKey }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}`, {
                headers: { Authorization: auth, Accept: "application/json" },
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}`, ticketKey }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `Jira API error: ${response.status}`,
              statusCode: response.status,
              ticketKey,
            });
          }
          const issue = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}`, ticketKey }),
          });
          return mapIssueToTicket(issue);
        }),

      searchTickets: ({ jql, maxResults }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const params = new URLSearchParams({
            jql,
            maxResults: String(maxResults ?? 50),
          });
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/search/jql?${params}`, {
                headers: { Authorization: auth, Accept: "application/json" },
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}` }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `Jira API error: ${response.status}`,
              statusCode: response.status,
            });
          }
          const data = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{ issues: any[] }>,
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}` }),
          });
          return (data.issues ?? []).map(mapIssueToTicket);
        }),

      postComment: ({ ticketKey, body }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}/comment`, {
                method: "POST",
                headers: {
                  Authorization: auth,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  body: {
                    type: "doc",
                    version: 1,
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: body }] },
                    ],
                  },
                }),
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}`, ticketKey }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `Jira API error: ${response.status}`,
              statusCode: response.status,
              ticketKey,
            });
          }
        }),

      refreshCache: () => Effect.succeed({ count: 0 }),
    });
  }),
);
