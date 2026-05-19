import type {
  CommitMutationInput,
  IntegrationAccount,
  IntegrationAccountRef,
  IntegrationAction,
  IntegrationProvider,
  IntegrationSearchInput,
  ListResourcesInput,
  MutationResult,
  PrepareMutationInput,
  PreparedMutation,
  ResourceSearchResult,
} from "@t3tools/integrations-core";
import type { ResourcePage, ResourceSnapshot } from "@t3tools/project-context";
import type { ExternalProject } from "@t3tools/integrations-core";
import { AtlassianApiError, AtlassianAuthError, AtlassianNetworkError } from "./client.ts";
import { JiraApiClient, type JiraApiAuth } from "./jiraApi.ts";
import {
  normalizeAccount,
  normalizeIssue,
  normalizeIssueSearch,
  normalizeProject,
} from "./normalize.ts";

export type AtlassianIntegrationProviderConfig = {
  readonly siteUrl: string;
  readonly email: string;
  readonly apiToken: string;
};

function normalizeSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.endsWith("/") ? withProtocol.slice(0, -1) : withProtocol;
}

function describeAccountError(
  siteUrl: string,
  authKind: JiraApiAuth["kind"],
  cause: unknown,
): string {
  if (cause instanceof AtlassianAuthError) {
    return `${siteUrl}: ${cause.message}`;
  }

  if (cause instanceof AtlassianApiError) {
    return `${siteUrl}: Atlassian API request failed (${cause.status})`;
  }

  if (cause instanceof AtlassianNetworkError) {
    const reason = cause.cause instanceof Error ? ` (${cause.cause.message})` : "";
    if (authKind === "basic") {
      return `${siteUrl}: Jira did not return an HTTP response${reason}. Check that the site URL is correct, the local backend can reach Atlassian, and the API token has Jira access.`;
    }
    return `${siteUrl}: Jira did not return an HTTP response${reason}. Check network connectivity, browser blocking, or CORS for this Atlassian site.`;
  }

  if (cause instanceof Error) {
    return `${siteUrl}: ${cause.message}`;
  }

  return `${siteUrl}: ${String(cause)}`;
}

export class AtlassianIntegrationProvider implements IntegrationProvider {
  id = "atlassian";
  kind = "atlassian";
  private clients: Map<string, { client: JiraApiClient; siteUrl: string }> = new Map();

  constructor(auth: JiraApiAuth | AtlassianIntegrationProviderConfig) {
    if ("kind" in auth) {
      const key = auth.kind === "oauth" ? auth.cloudId : normalizeSiteUrl(auth.siteUrl);
      const clientAuth: JiraApiAuth =
        auth.kind === "basic" ? { ...auth, siteUrl: normalizeSiteUrl(auth.siteUrl) } : auth;
      this.clients.set(key, {
        client: new JiraApiClient(clientAuth),
        siteUrl:
          auth.kind === "oauth"
            ? `https://api.atlassian.com/ex/jira/${auth.cloudId}`
            : normalizeSiteUrl(auth.siteUrl),
      });
    } else {
      const siteUrl = normalizeSiteUrl(auth.siteUrl);
      this.clients.set(siteUrl, {
        client: new JiraApiClient({ ...auth, kind: "basic", siteUrl }),
        siteUrl,
      });
    }
  }

  static fromMultipleAuths(auths: ReadonlyArray<JiraApiAuth>): AtlassianIntegrationProvider {
    const provider = Object.create(
      AtlassianIntegrationProvider.prototype,
    ) as AtlassianIntegrationProvider;
    provider.id = "atlassian";
    provider.kind = "atlassian";
    provider.clients = new Map();
    for (const auth of auths) {
      const key = auth.kind === "oauth" ? auth.cloudId : normalizeSiteUrl(auth.siteUrl);
      const clientAuth: JiraApiAuth =
        auth.kind === "basic" ? { ...auth, siteUrl: normalizeSiteUrl(auth.siteUrl) } : auth;
      provider.clients.set(key, {
        client: new JiraApiClient(clientAuth),
        siteUrl:
          auth.kind === "oauth"
            ? `https://api.atlassian.com/ex/jira/${auth.cloudId}`
            : normalizeSiteUrl(auth.siteUrl),
      });
    }
    return provider;
  }

  private getClientForAccount(
    accountId: string,
  ): { client: JiraApiClient; siteUrl: string } | undefined {
    return this.clients.get(accountId);
  }

  private getDefaultClient(): { client: JiraApiClient; siteUrl: string } | undefined {
    const first = this.clients.values().next().value;
    return first;
  }

  async listAccounts(): Promise<ReadonlyArray<IntegrationAccount>> {
    const accounts: IntegrationAccount[] = [];
    const failures: string[] = [];
    for (const [key, { client, siteUrl }] of this.clients) {
      try {
        const myself = await client.getMyself();
        accounts.push(normalizeAccount(siteUrl, myself, key));
      } catch (cause) {
        failures.push(describeAccountError(siteUrl, client.authKind, cause));
      }
    }
    if (accounts.length === 0 && failures.length > 0) {
      throw new Error(`Failed to connect to Atlassian. ${failures.join("; ")}`);
    }
    return accounts;
  }

  async listProjects(account: IntegrationAccountRef): Promise<ReadonlyArray<ExternalProject>> {
    const entry = this.getClientForAccount(account.id) ?? this.getDefaultClient();
    if (!entry) return [];
    const response = await entry.client.searchProjects();
    const enrichedProjects = await Promise.all(
      response.values.map(async (project) => {
        if (project.avatarUrls && Object.keys(project.avatarUrls).length > 0) {
          return project;
        }
        try {
          return await entry.client.getProject(project.id);
        } catch {
          return project;
        }
      }),
    );

    return enrichedProjects.map((project) => normalizeProject(project, entry.siteUrl));
  }

  async listResources(input: ListResourcesInput): Promise<ResourcePage> {
    const entry = this.getClientForAccount(input.account.id) ?? this.getDefaultClient();
    if (!entry) return { items: [], totalCount: 0 };

    const project = await this.findProjectById(input.externalProjectId, entry.client);
    if (!project) {
      return { items: [], totalCount: 0 };
    }

    const projectKey = project.key.replace(/"/g, '\\"');
    const assignedJql = `project = "${projectKey}" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    const assignedResponse = await entry.client.searchIssues(assignedJql, input.limit ?? 50);
    const assignedItems = normalizeIssueSearch(assignedResponse, entry.siteUrl);

    const parentKeys = new Set<string>();
    for (const issue of assignedResponse.issues) {
      if (!issue || typeof issue !== "object") continue;
      const fields = (issue as { fields?: unknown }).fields;
      if (!fields || typeof fields !== "object") continue;
      const parent = (fields as { parent?: unknown }).parent;
      if (!parent || typeof parent !== "object") continue;
      const parentKey = (parent as { key?: unknown }).key;
      if (typeof parentKey === "string" && parentKey.trim().length > 0) {
        parentKeys.add(parentKey);
      }
    }

    const assignedDisplayIds = new Set(assignedItems.map((item) => item.displayId));
    const missingParentKeys = [...parentKeys].filter((key) => !assignedDisplayIds.has(key));

    let parentItems: ReadonlyArray<(typeof assignedItems)[number]> = [];
    if (missingParentKeys.length > 0) {
      const quotedParentKeys = missingParentKeys.map((key) => `"${key.replace(/"/g, '\\"')}"`);
      const parentJql = `key in (${quotedParentKeys.join(", ")}) ORDER BY updated DESC`;
      const parentResponse = await entry.client.searchIssues(parentJql, missingParentKeys.length);
      parentItems = normalizeIssueSearch(parentResponse, entry.siteUrl);
    }

    const itemsById = new Map<string, (typeof assignedItems)[number]>();
    for (const item of assignedItems) {
      itemsById.set(item.id, item);
    }
    for (const item of parentItems) {
      itemsById.set(item.id, item);
    }
    const items = [...itemsById.values()];

    return {
      items,
      totalCount: items.length,
    };
  }

  async getResource(ref: unknown): Promise<ResourceSnapshot> {
    const typedRef = ref as {
      id: string;
      provider: string;
      kind: string;
      projectId?: string;
      url?: string;
    };
    const entry = this.getDefaultClient();
    if (!entry) throw new Error("No Jira client available");
    const issue = await entry.client.getIssue(typedRef.id);
    return normalizeIssue(issue, entry.siteUrl);
  }

  async downloadAsset(url: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const entry = this.getDefaultClient();
    if (!entry) throw new Error("No Jira client available");
    return entry.client.downloadAsset(url);
  }

  async search(input: IntegrationSearchInput): Promise<ReadonlyArray<ResourceSearchResult>> {
    const entry = this.getClientForAccount(input.account.id) ?? this.getDefaultClient();
    if (!entry) return [];

    const projectKey = input.externalProjectId
      ? (await this.findProjectById(input.externalProjectId, entry.client))?.key
      : undefined;

    const textQuery = input.query.trim();
    if (!textQuery) return [];

    const jqlParts: string[] = [];
    if (projectKey) {
      const quotedProjectKey = projectKey.replace(/"/g, '\\"');
      jqlParts.push(`project = "${quotedProjectKey}"`);
    }
    jqlParts.push(`text ~ "${textQuery.replace(/"/g, '\\"')}"`);
    const jql = jqlParts.join(" AND ");

    const response = await entry.client.searchIssues(jql, input.limit ?? 20);
    const items = normalizeIssueSearch(response, entry.siteUrl);

    return items.map((item) => ({
      ref: item,
    }));
  }

  async getAvailableActions(_ref: unknown): Promise<ReadonlyArray<IntegrationAction>> {
    return [
      {
        id: "jira.comment.prepare",
        label: "Prepare Jira comment",
        kind: "mutate",
        requiresApproval: true,
      },
    ];
  }

  async prepareMutation(input: PrepareMutationInput): Promise<PreparedMutation> {
    return {
      mutationId: crypto.randomUUID(),
      preview: `Add comment to issue`,
      editableFields: ["body"],
      payload: input.payload,
    };
  }

  async commitMutation(input: CommitMutationInput): Promise<MutationResult> {
    const payload = input.approvedPayload as { issueId?: string; body?: string };
    if (!payload.issueId || !payload.body) {
      return { success: false, errorMessage: "Missing issueId or body" };
    }

    const entry = this.getDefaultClient();
    if (!entry) {
      return { success: false, errorMessage: "No Jira client available" };
    }

    try {
      await entry.client.addIssueComment(payload.issueId, payload.body);
      return {
        success: true,
        externalUrl: `${entry.siteUrl}/browse/${payload.issueId}`,
      };
    } catch (error) {
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : "Failed to post comment",
      };
    }
  }

  private async findProjectById(
    projectId: string,
    client: JiraApiClient,
  ): Promise<{ id: string; key: string } | null> {
    const projects = await client.searchProjects();
    const match = projects.values.find((p) => p.id === projectId);
    if (!match) return null;
    return { id: match.id, key: match.key };
  }
}
