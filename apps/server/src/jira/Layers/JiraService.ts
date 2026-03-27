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
          const jqlEncoded = encodeURIComponent(jql);
          const limit = maxResults ?? 50;
          const url = `${JIRA_BASE_URL}/rest/api/3/search/jql?jql=${jqlEncoded}&maxResults=${limit}&fields=*all`;
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
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
          const jqlEncoded = encodeURIComponent(jql);
          const limit = maxResults ?? 50;
          const url = `${JIRA_BASE_URL}/rest/api/3/search/jql?jql=${jqlEncoded}&maxResults=${limit}&fields=*all`;
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
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

      transitionTicket: ({ ticketKey, transitionName }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const transitionsResponse = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}/transitions`, {
                headers: { Authorization: auth, Accept: "application/json" },
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}`, ticketKey }),
          });
          if (!transitionsResponse.ok) {
            return yield* new JiraApiError({
              message: `Jira API error: ${transitionsResponse.status}`,
              statusCode: transitionsResponse.status,
              ticketKey,
            });
          }
          const transitionsData = yield* Effect.tryPromise({
            try: () =>
              transitionsResponse.json() as Promise<{
                transitions?: Array<{ id: string; name: string }>;
              }>,
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}`, ticketKey }),
          });
          const target = (transitionsData.transitions ?? []).find(
            (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
          );
          if (!target) {
            return yield* new JiraApiError({
              message: `Transition "${transitionName}" not available for ${ticketKey}`,
              ticketKey,
            });
          }
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}/transitions`, {
                method: "POST",
                headers: {
                  Authorization: auth,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ transition: { id: target.id } }),
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}`, ticketKey }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `Transition failed: ${response.status}`,
              statusCode: response.status,
              ticketKey,
            });
          }
        }),

      listServiceDeskRequestTypes: () =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/servicedeskapi/servicedesk/1/requesttype`, {
                headers: { Authorization: auth, Accept: "application/json" },
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}` }),
          });
          if (!response.ok) {
            return yield* new JiraApiError({
              message: `JSM API error: ${response.status}`,
              statusCode: response.status,
            });
          }
          const data = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{ values?: any[] }>,
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}` }),
          });
          return (data.values ?? [])
            .filter((v: any) => v.canCreateRequest)
            .map((v: any) => {
              const entry: { id: string; name: string; description?: string } = {
                id: v.id as string,
                name: v.name as string,
              };
              if (v.description) entry.description = v.description as string;
              return entry;
            });
        }),

      createServiceDeskRequest: ({ requestTypeId, summary, description }) =>
        Effect.gen(function* () {
          const auth = yield* getAuthHeader();
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${JIRA_BASE_URL}/rest/servicedeskapi/request`, {
                method: "POST",
                headers: {
                  Authorization: auth,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  serviceDeskId: "1",
                  requestTypeId,
                  requestFieldValues: {
                    summary,
                    ...(description ? { description } : {}),
                  },
                }),
              }),
            catch: (e) => new JiraApiError({ message: `Fetch failed: ${e}` }),
          });
          if (!response.ok) {
            const text = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: (e) => new JiraApiError({ message: `Failed to read error response: ${e}` }),
            });
            return yield* new JiraApiError({
              message: `JSM API error ${response.status}: ${text}`,
              statusCode: response.status,
            });
          }
          const data = yield* Effect.tryPromise({
            try: () =>
              response.json() as Promise<{
                issueKey: string;
                _links?: { agent?: string };
              }>,
            catch: (e) => new JiraApiError({ message: `JSON parse failed: ${e}` }),
          });
          return {
            issueKey: data.issueKey,
            url: data._links?.agent ?? `${JIRA_BASE_URL}/browse/${data.issueKey}`,
          };
        }),
    });
  }),
);
