import { Effect, Layer, Option } from "effect";
import { ServerConfig } from "../../config.ts";
import type {
  JiraConnectionStatus,
  JiraGetAttachmentInput,
  JiraGetAttachmentResult,
  JiraGetIssueInput,
  JiraIssue,
  JiraListBoardsInput,
  JiraListBoardsResult,
  JiraListIssuesInput,
  JiraListIssuesResult,
  JiraListSprintsInput,
  JiraListSprintsResult,
  JiraSite,
  JiraUser,
} from "@marcode/contracts";
import { JiraApiClient, type JiraApiClientShape } from "../Services/JiraApiClient.ts";
import { JiraTokenService } from "../Services/JiraTokenService.ts";
import { JiraApiError } from "../Errors.ts";

const ATLASSIAN_API_BASE = "https://api.atlassian.com";

const jiraApiFetch = (
  accessToken: string,
  path: string,
  init?: RequestInit,
): Effect.Effect<Response, JiraApiError> =>
  Effect.tryPromise({
    try: () =>
      fetch(`${ATLASSIAN_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...init?.headers,
        },
      }),
    catch: (cause) =>
      new JiraApiError({ operation: "fetch", detail: `Failed to fetch ${path}`, cause }),
  });

const assertOk = (response: Response, operation: string): Effect.Effect<void, JiraApiError> =>
  response.ok
    ? Effect.void
    : Effect.tryPromise({
        try: () => response.text(),
        catch: () =>
          new JiraApiError({
            operation,
            detail: `HTTP ${response.status}`,
            statusCode: response.status,
          }),
      }).pipe(
        Effect.flatMap((body) =>
          Effect.fail(
            new JiraApiError({
              operation,
              detail: `HTTP ${response.status}: ${body.slice(0, 500)}`,
              statusCode: response.status,
            }),
          ),
        ),
      );

const parseJsonResponse = <T>(
  response: Response,
  operation: string,
): Effect.Effect<T, JiraApiError> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<T>,
    catch: (cause) =>
      new JiraApiError({ operation, detail: "Failed to parse JSON response", cause }),
  });

export const JiraApiClientLive = Layer.effect(
  JiraApiClient,
  Effect.gen(function* () {
    const tokenService = yield* JiraTokenService;
    const config = yield* ServerConfig;
    const serverPort = config.port;

    const siteUrlByCloudId = new Map<string, string>();

    const authedFetch = (path: string, operation: string, init?: RequestInit) =>
      Effect.gen(function* () {
        const accessToken = yield* tokenService.getValidAccessToken;
        const response = yield* jiraApiFetch(accessToken, path, init);
        if (!response.ok) {
          const tokensOpt = yield* tokenService.getTokens;
          const tokenScope = Option.isSome(tokensOpt) ? tokensOpt.value.scope : "unknown";
          const body = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (cause) =>
              new JiraApiError({
                operation,
                detail: `HTTP ${response.status} (failed to read body)`,
                statusCode: response.status,
                cause,
              }),
          });
          return yield* Effect.fail(
            new JiraApiError({
              operation,
              detail: `HTTP ${response.status}: ${body.slice(0, 300)} [token scopes: ${tokenScope}]`,
              statusCode: response.status,
            }),
          );
        }
        return response;
      });

    const getAccessibleResources: JiraApiClientShape["getAccessibleResources"] = Effect.gen(
      function* () {
        const response = yield* authedFetch(
          "/oauth/token/accessible-resources",
          "getAccessibleResources",
        );
        const data = yield* parseJsonResponse<
          ReadonlyArray<{
            id: string;
            name: string;
            url: string;
            avatarUrl?: string;
          }>
        >(response, "getAccessibleResources");
        return data.map((site) => {
          siteUrlByCloudId.set(site.id, site.url);
          const result: Record<string, string> = {
            cloudId: site.id,
            name: site.name,
            url: site.url,
          };
          if (site.avatarUrl) {
            result.avatarUrl = site.avatarUrl;
          }
          return result as unknown as JiraSite;
        });
      },
    );

    const getCurrentUser = Effect.gen(function* () {
      const response = yield* authedFetch("/me", "getCurrentUser");
      const data = yield* parseJsonResponse<{
        account_id: string;
        name: string;
        picture?: string;
      }>(response, "getCurrentUser");
      return {
        accountId: data.account_id,
        displayName: data.name,
        ...(data.picture ? { avatarUrl: data.picture } : {}),
      } as unknown as JiraUser;
    });

    const getConnectionStatus: JiraApiClientShape["getConnectionStatus"] = Effect.gen(function* () {
      const tokensOpt = yield* tokenService.getTokens;
      if (Option.isNone(tokensOpt)) {
        return {
          connected: false,
          sites: [],
        } as unknown as JiraConnectionStatus;
      }

      const sites = yield* getAccessibleResources;
      const user = yield* getCurrentUser;
      return {
        connected: true,
        sites,
        user,
      } as unknown as JiraConnectionStatus;
    });

    const listBoards: JiraApiClientShape["listBoards"] = (input: JiraListBoardsInput) =>
      Effect.gen(function* () {
        const response = yield* authedFetch(
          `/ex/jira/${input.cloudId}/rest/api/3/project/search?maxResults=100&orderBy=name&status=live`,
          "listBoards",
        );
        const data = yield* parseJsonResponse<{
          values: ReadonlyArray<{ id: string; key: string; name: string; projectTypeKey: string }>;
        }>(response, "listBoards");
        return {
          boards: data.values.map(
            (project) =>
              ({
                id: Number(project.id),
                name: `${project.key} — ${project.name}`,
                type: project.projectTypeKey === "software" ? "scrum" : "kanban",
              }) as unknown as JiraListBoardsResult["boards"][number],
          ),
        } as JiraListBoardsResult;
      });

    const listSprints: JiraApiClientShape["listSprints"] = (_input: JiraListSprintsInput) =>
      Effect.succeed({ sprints: [] } as unknown as JiraListSprintsResult);

    const listIssues: JiraApiClientShape["listIssues"] = (input: JiraListIssuesInput) =>
      Effect.gen(function* () {
        const startAt = input.startAt ?? 0;
        const maxResults = input.maxResults ?? 50;

        let path: string;
        const fields =
          "summary,status,issuetype,priority,assignee,description,labels,attachment,created,updated";
        const projectClause =
          input.boardId !== undefined ? `project = ${input.boardId}` : undefined;
        if (input.sprintId !== undefined) {
          const parts = [projectClause, `sprint = ${input.sprintId}`].filter(Boolean);
          const jql = encodeURIComponent(`${parts.join(" AND ")} ORDER BY updated DESC`);
          path = `/ex/jira/${input.cloudId}/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;
        } else if (input.query !== undefined && input.query.length > 0) {
          const keyPatternMatch = input.query.match(/^([A-Z][A-Z0-9]+)-?(\d*)$/i);
          let queryClause: string;
          if (keyPatternMatch && keyPatternMatch[1]) {
            const projectKey = keyPatternMatch[1].toUpperCase();
            const digits = keyPatternMatch[2] ?? "";
            if (digits.length > 0) {
              const n = Number(digits);
              const keys: string[] = [`${projectKey}-${n}`];
              const lo = n * 10;
              const hi = (n + 1) * 10 - 1;
              for (let i = lo; i <= hi; i++) keys.push(`${projectKey}-${i}`);
              queryClause = `key in (${keys.join(", ")})`;
            } else {
              queryClause = `project = "${projectKey}" AND sprint in openSprints() AND assignee = currentUser()`;
            }
          } else {
            queryClause = `text ~ "${input.query}"`;
          }
          const isKeySearch = !!keyPatternMatch;
          const parts = [projectClause, queryClause].filter(Boolean);
          const orderBy = isKeySearch ? "ORDER BY key ASC" : "ORDER BY updated DESC";
          const rawJql = `${parts.join(" AND ")} ${orderBy}`;
          const jql = encodeURIComponent(rawJql);
          path = `/ex/jira/${input.cloudId}/rest/api/3/search/jql?jql=${jql}&validateQuery=warn&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;

          const response = yield* authedFetch(path, "listIssues");
          const data = yield* parseJsonResponse<{
            issues: ReadonlyArray<JiraApiIssueRaw>;
            total?: number;
          }>(response, "listIssues");

          if (data.issues.length === 0 && keyPatternMatch) {
            const digits = keyPatternMatch[2] ?? "";
            const projectKey = keyPatternMatch[1]!.toUpperCase();
            if (digits.length > 0) {
              const n = Number(digits);
              const wideKeys: string[] = [];
              const lo100 = n * 100;
              const hi100 = (n + 1) * 100 - 1;
              for (let i = lo100; i <= hi100; i++) wideKeys.push(`${projectKey}-${i}`);
              const wideClause = `key in (${wideKeys.join(", ")})`;
              const wideParts = [projectClause, wideClause].filter(Boolean);
              const wideRawJql = `${wideParts.join(" AND ")} ORDER BY key ASC`;
              const wideJql = encodeURIComponent(wideRawJql);
              const widePath = `/ex/jira/${input.cloudId}/rest/api/3/search/jql?jql=${wideJql}&validateQuery=warn&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;
              const wideResponse = yield* authedFetch(widePath, "listIssues");
              const wideData = yield* parseJsonResponse<{
                issues: ReadonlyArray<JiraApiIssueRaw>;
                total?: number;
              }>(wideResponse, "listIssues");
              return {
                issues: wideData.issues.map(
                  mapRawIssue(input.cloudId as string, siteUrlByCloudId, serverPort),
                ),
                total: wideData.total ?? wideData.issues.length,
              } as unknown as JiraListIssuesResult;
            }
            const fallbackJql = encodeURIComponent(
              `${[projectClause, `project = "${projectKey}"`].filter(Boolean).join(" AND ")} ORDER BY updated DESC`,
            );
            const fallbackPath = `/ex/jira/${input.cloudId}/rest/api/3/search/jql?jql=${fallbackJql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;
            const fallbackResponse = yield* authedFetch(fallbackPath, "listIssues");
            const fallbackData = yield* parseJsonResponse<{
              issues: ReadonlyArray<JiraApiIssueRaw>;
              total: number;
            }>(fallbackResponse, "listIssues");
            return {
              issues: fallbackData.issues.map(
                mapRawIssue(input.cloudId as string, siteUrlByCloudId, serverPort),
              ),
              total: fallbackData.total ?? fallbackData.issues.length,
            } as unknown as JiraListIssuesResult;
          }

          return {
            issues: data.issues.map(
              mapRawIssue(input.cloudId as string, siteUrlByCloudId, serverPort),
            ),
            total: data.total ?? data.issues.length,
          } as unknown as JiraListIssuesResult;
        } else {
          const jql = encodeURIComponent(
            projectClause ? `${projectClause} ORDER BY updated DESC` : `ORDER BY updated DESC`,
          );
          path = `/ex/jira/${input.cloudId}/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;
        }

        const response = yield* authedFetch(path, "listIssues");
        const data = yield* parseJsonResponse<{
          issues: ReadonlyArray<JiraApiIssueRaw>;
          total: number;
        }>(response, "listIssues");

        return {
          issues: data.issues.map(
            mapRawIssue(input.cloudId as string, siteUrlByCloudId, serverPort),
          ),
          total: data.total ?? data.issues.length,
        } as unknown as JiraListIssuesResult;
      });

    const getIssue: JiraApiClientShape["getIssue"] = (input: JiraGetIssueInput) =>
      Effect.gen(function* () {
        const response = yield* authedFetch(
          `/ex/jira/${input.cloudId}/rest/api/3/issue/${input.issueKey}?fields=summary,status,issuetype,priority,assignee,description,labels,attachment,created,updated`,
          "getIssue",
        );
        const data = yield* parseJsonResponse<JiraApiIssueRaw>(response, "getIssue");
        return mapRawIssue(
          input.cloudId as string,
          siteUrlByCloudId,
          serverPort,
        )(data) as unknown as JiraIssue;
      });

    const getAttachment: JiraApiClientShape["getAttachment"] = (input: JiraGetAttachmentInput) =>
      Effect.gen(function* () {
        const metaResponse = yield* authedFetch(
          `/ex/jira/${input.cloudId}/rest/api/3/attachment/${input.attachmentId}`,
          "getAttachment.meta",
        );
        const meta = yield* parseJsonResponse<{
          content: string;
          filename: string;
          mimeType: string;
        }>(metaResponse, "getAttachment.meta");

        const accessToken = yield* tokenService.getValidAccessToken;
        const contentResponse = yield* Effect.tryPromise({
          try: () =>
            fetch(meta.content, {
              headers: { Authorization: `Bearer ${accessToken}` },
            }),
          catch: (cause) =>
            new JiraApiError({
              operation: "getAttachment.download",
              detail: "Failed to download attachment",
              cause,
            }),
        });
        yield* assertOk(contentResponse, "getAttachment.download");

        const isTextMime =
          meta.mimeType.startsWith("text/") || meta.mimeType === "application/json";
        const isImageMime = meta.mimeType.startsWith("image/");

        let content: string;
        if (isTextMime) {
          content = yield* Effect.tryPromise({
            try: () => contentResponse.text(),
            catch: (cause) =>
              new JiraApiError({
                operation: "getAttachment.readText",
                detail: "Failed to read text attachment",
                cause,
              }),
          });
        } else if (isImageMime) {
          const buffer = yield* Effect.tryPromise({
            try: () => contentResponse.arrayBuffer(),
            catch: (cause) =>
              new JiraApiError({
                operation: "getAttachment.readImage",
                detail: "Failed to read image attachment",
                cause,
              }),
          });
          content = `data:${meta.mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
        } else {
          content = `[Binary file: ${meta.filename} (${meta.mimeType})]`;
        }

        return {
          content,
          mimeType: meta.mimeType,
          filename: meta.filename,
        } as unknown as JiraGetAttachmentResult;
      });

    const disconnect: JiraApiClientShape["disconnect"] = tokenService.clearTokens;

    return {
      getConnectionStatus,
      getAccessibleResources,
      listBoards,
      listSprints,
      listIssues,
      getIssue,
      getAttachment,
      disconnect,
    };
  }),
);

interface JiraApiIssueRaw {
  readonly key: string;
  readonly self: string;
  readonly fields: {
    readonly summary: string;
    readonly status: { readonly name: string };
    readonly issuetype: { readonly name: string };
    readonly priority?: { readonly name: string } | null;
    readonly assignee?: {
      readonly accountId: string;
      readonly displayName: string;
      readonly avatarUrls?: { readonly "48x48"?: string };
    } | null;
    readonly description?: unknown;
    readonly labels?: ReadonlyArray<string>;
    readonly attachment?: ReadonlyArray<{
      readonly id: string;
      readonly filename: string;
      readonly mimeType: string;
      readonly size: number;
    }>;
    readonly created: string;
    readonly updated: string;
  };
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: ReadonlyArray<{ type: string; attrs?: Record<string, unknown> }>;
  content?: ReadonlyArray<AdfNode>;
}

function renderAdfInlineText(node: AdfNode): string {
  if (node.type === "text" && typeof node.text === "string") {
    let text = node.text;
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "link" && mark.attrs?.href) text = `[${text}](${mark.attrs.href})`;
        else if (mark.type === "strike") text = `~~${text}~~`;
      }
    }
    return text;
  }
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention" && node.attrs?.text) return String(node.attrs.text);
  if (node.type === "emoji" && node.attrs?.shortName) return String(node.attrs.shortName);
  if (node.type === "inlineCard" && node.attrs?.url) return String(node.attrs.url);
  if (node.content) return node.content.map(renderAdfInlineText).join("");
  return "";
}

function renderAdfChildren(
  nodes: ReadonlyArray<AdfNode>,
  context?: { listPrefix?: string },
): string {
  const blocks: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i]!;
    blocks.push(renderAdfBlock(child, i, context));
  }
  return blocks.join("\n\n");
}

function renderAdfBlock(node: AdfNode, index: number, context?: { listPrefix?: string }): string {
  if (!node.type) return "";

  if (node.type === "paragraph") {
    return node.content ? node.content.map(renderAdfInlineText).join("") : "";
  }

  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 1);
    const prefix = "#".repeat(Math.min(level, 6));
    const text = node.content ? node.content.map(renderAdfInlineText).join("") : "";
    return `${prefix} ${text}`;
  }

  if (node.type === "bulletList" && node.content) {
    return node.content
      .map((item) => {
        const inner = item.content ? renderAdfChildren(item.content, { listPrefix: "  " }) : "";
        return `- ${inner}`;
      })
      .join("\n");
  }

  if (node.type === "orderedList" && node.content) {
    return node.content
      .map((item, idx) => {
        const inner = item.content ? renderAdfChildren(item.content, { listPrefix: "  " }) : "";
        return `${idx + 1}. ${inner}`;
      })
      .join("\n");
  }

  if (node.type === "codeBlock") {
    const lang = (node.attrs?.language as string) ?? "";
    const code = node.content ? node.content.map(renderAdfInlineText).join("") : "";
    return `\`\`\`${lang}\n${code}\n\`\`\``;
  }

  if (node.type === "blockquote" && node.content) {
    return renderAdfChildren(node.content)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (node.type === "panel" && node.content) {
    const inner = renderAdfChildren(node.content);
    return `> ${inner.split("\n").join("\n> ")}`;
  }

  if (node.type === "rule") {
    return "---";
  }

  if (node.type === "mediaSingle" || node.type === "mediaGroup") {
    if (!node.content) return "";
    return node.content
      .map((media) => {
        if (media.type === "media") {
          const alt = (media.attrs?.alt as string) ?? (media.attrs?.id as string) ?? "attachment";
          const filename = alt;
          const ctx = adfRenderContext;
          const att = ctx?.attachmentsByFilename.get(filename);
          if (att && att.mimeType.startsWith("image/") && ctx) {
            const proxyUrl = `http://localhost:${ctx.serverPort}/api/jira/attachment/${att.id}?cloudId=${encodeURIComponent(ctx.cloudId)}`;
            return `![${filename}](${proxyUrl})`;
          }
          return `[📎 ${filename}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (node.type === "table" && node.content) {
    const rows = node.content.filter((row) => row.type === "tableRow");
    return rows
      .map((row, rowIdx) => {
        const cells = (row.content ?? []).map((cell) =>
          cell.content ? renderAdfChildren(cell.content).replace(/\n/g, " ") : "",
        );
        const line = `| ${cells.join(" | ")} |`;
        if (rowIdx === 0) {
          return `${line}\n| ${cells.map(() => "---").join(" | ")} |`;
        }
        return line;
      })
      .join("\n");
  }

  if (node.content) {
    return renderAdfChildren(node.content, context);
  }

  return "";
}

interface AdfRenderContext {
  readonly attachmentsByFilename: ReadonlyMap<string, { id: string; mimeType: string }>;
  readonly cloudId: string;
  readonly serverPort: number;
}

let adfRenderContext: AdfRenderContext | undefined;

function renderAdfToMarkdown(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);

  const adf = node as AdfNode;
  if (adf.type === "doc" && adf.content) {
    return renderAdfChildren(adf.content);
  }
  if (adf.content) {
    return renderAdfChildren(adf.content);
  }
  if (adf.type === "text" && typeof adf.text === "string") {
    return adf.text;
  }
  return "";
}

const mapRawIssue =
  (cloudId: string, siteUrlByCloudId: Map<string, string>, serverPort: number) =>
  (raw: JiraApiIssueRaw) => {
    const attachmentsByFilename = new Map(
      (raw.fields.attachment ?? []).map((att) => [
        att.filename,
        { id: att.id, mimeType: att.mimeType },
      ]),
    );
    adfRenderContext = { attachmentsByFilename, cloudId, serverPort };
    const description = renderAdfToMarkdown(raw.fields.description);
    adfRenderContext = undefined;
    return {
      key: raw.key.trim(),
      summary: raw.fields.summary.trim(),
      status: raw.fields.status.name.trim(),
      issueType: raw.fields.issuetype.name.trim(),
      ...(raw.fields.priority ? { priority: raw.fields.priority.name.trim() } : {}),
      ...(raw.fields.assignee
        ? {
            assignee: {
              accountId: raw.fields.assignee.accountId.trim(),
              displayName: raw.fields.assignee.displayName.trim(),
              ...(raw.fields.assignee.avatarUrls?.["48x48"]
                ? { avatarUrl: raw.fields.assignee.avatarUrls["48x48"].trim() }
                : {}),
            },
          }
        : {}),
      description,
      labels: raw.fields.labels ?? [],
      attachments: (raw.fields.attachment ?? []).map((att) => ({
        id: att.id.trim(),
        filename: att.filename.trim(),
        mimeType: att.mimeType.trim(),
        size: att.size,
      })),
      url: siteUrlByCloudId.has(cloudId)
        ? `${siteUrlByCloudId.get(cloudId)}/browse/${raw.key}`
        : `https://api.atlassian.com/ex/jira/${cloudId}/browse/${raw.key}`,
      createdAt: raw.fields.created,
      updatedAt: raw.fields.updated,
    };
  };
