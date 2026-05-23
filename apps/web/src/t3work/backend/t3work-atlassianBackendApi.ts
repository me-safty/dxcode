import type {
  ExternalProject,
  IntegrationAccount,
  IntegrationAccountRef,
} from "@t3tools/integrations-core";
import type { ResourcePage, ResourceSnapshot } from "@t3tools/project-context";

import type {
  AtlassianAssignableUser,
  AtlassianBackendApi,
  AtlassianBacklogResponse,
  AtlassianBasicConnectInput,
  AtlassianBoardColumnsResponse,
  AtlassianDownloadedAsset,
  AtlassianOAuthConnectInput,
  AtlassianOAuthExchangeInput,
  AtlassianOAuthExchangeResult,
} from "./t3work-atlassianBackendTypes";
import { postJson } from "./t3work-t3BackendHttp";

export function createAtlassianBackendApi(httpBaseUrl: string): AtlassianBackendApi {
  const post = <TRequest extends object, TResponse>(path: string, body: TRequest) =>
    postJson<TRequest, TResponse>(httpBaseUrl, path, body);

  return {
    async listAccounts(): Promise<ReadonlyArray<IntegrationAccount>> {
      const response = await post<object, { accounts: ReadonlyArray<IntegrationAccount> }>(
        "/api/t3work/atlassian/accounts",
        {},
      );
      return response.accounts;
    },

    async connectBasic(
      input: AtlassianBasicConnectInput,
    ): Promise<ReadonlyArray<IntegrationAccount>> {
      const response = await post<
        { auth: { kind: "basic"; siteUrl: string; email: string; apiToken: string } },
        { accounts: ReadonlyArray<IntegrationAccount> }
      >("/api/t3work/atlassian/connect/basic", {
        auth: {
          kind: "basic",
          siteUrl: input.siteUrl,
          email: input.email,
          apiToken: input.apiToken,
        },
      });
      return response.accounts;
    },

    async connectOAuth(
      input: AtlassianOAuthConnectInput,
    ): Promise<ReadonlyArray<IntegrationAccount>> {
      const response = await post<
        {
          auth: {
            kind: "oauth";
            sites: AtlassianOAuthConnectInput["sites"];
            token: AtlassianOAuthConnectInput["token"];
          };
        },
        { accounts: ReadonlyArray<IntegrationAccount> }
      >("/api/t3work/atlassian/connect/oauth", {
        auth: {
          kind: "oauth",
          sites: input.sites,
          token: input.token,
        },
      });
      return response.accounts;
    },

    exchangeOAuthCode(input: AtlassianOAuthExchangeInput): Promise<AtlassianOAuthExchangeResult> {
      return post<AtlassianOAuthExchangeInput, AtlassianOAuthExchangeResult>(
        "/api/t3work/atlassian/oauth/exchange",
        input,
      );
    },

    async listProjects(account: IntegrationAccountRef): Promise<ReadonlyArray<ExternalProject>> {
      const response = await post<
        IntegrationAccountRef,
        { projects: ReadonlyArray<ExternalProject> }
      >("/api/t3work/atlassian/projects", account);
      return response.projects;
    },

    async listResources(input: {
      readonly account: IntegrationAccountRef;
      readonly externalProjectId: string;
      readonly limit?: number;
    }): Promise<ResourcePage> {
      const response = await post<typeof input, { page: ResourcePage }>(
        "/api/t3work/atlassian/resources",
        input,
      );
      return response.page;
    },

    async listBacklog(input: {
      readonly account: IntegrationAccountRef;
      readonly externalProjectId: string;
      readonly limit?: number;
      readonly boardId?: string;
      readonly sprintId?: string;
      readonly filterId?: string;
      readonly forceRefresh?: boolean;
      readonly clearProjectCache?: boolean;
    }) {
      return post<typeof input, AtlassianBacklogResponse>("/api/t3work/atlassian/backlog", input);
    },

    async getBoardColumns(input: {
      readonly account: IntegrationAccountRef;
      readonly externalProjectId: string;
      readonly boardId?: string;
    }) {
      return post<typeof input, AtlassianBoardColumnsResponse>(
        "/api/t3work/atlassian/board-columns",
        input,
      );
    },

    async getResource(input: {
      readonly accountId: string;
      readonly ref: unknown;
    }): Promise<ResourceSnapshot> {
      const response = await post<typeof input, { snapshot: ResourceSnapshot }>(
        "/api/t3work/atlassian/resource",
        input,
      );
      return response.snapshot;
    },

    async searchAssignableUsers(input: {
      readonly accountId: string;
      readonly issueIdOrKey: string;
      readonly query?: string;
    }): Promise<ReadonlyArray<AtlassianAssignableUser>> {
      const response = await post<typeof input, { users: ReadonlyArray<AtlassianAssignableUser> }>(
        "/api/t3work/atlassian/backlog/assignable-users",
        input,
      );
      return response.users;
    },

    async updateIssueAssignee(input: {
      readonly accountId: string;
      readonly issueIdOrKey: string;
      readonly assigneeAccountId?: string | null;
      readonly assigneeDisplayName?: string | null;
    }): Promise<void> {
      await post<typeof input, { ok: true }>(
        "/api/t3work/atlassian/backlog/update-assignee",
        input,
      );
    },

    async updateIssueEstimate(input: {
      readonly accountId: string;
      readonly issueIdOrKey: string;
      readonly estimateValue: number | null;
      readonly estimateMode?: "points" | "hours";
    }): Promise<{ label: string }> {
      const response = await post<typeof input, { ok: true; label: string }>(
        "/api/t3work/atlassian/backlog/update-estimate",
        input,
      );
      return { label: response.label };
    },

    async updateIssueStatus(input: {
      readonly accountId: string;
      readonly issueIdOrKey: string;
      readonly targetStatus: string;
    }): Promise<{ status: string }> {
      const response = await post<typeof input, { ok: true; status: string }>(
        "/api/t3work/atlassian/issue/update-status",
        input,
      );
      return { status: response.status };
    },

    async createSubtask(input: {
      readonly accountId: string;
      readonly projectId: string;
      readonly parentIssueIdOrKey: string;
      readonly summary: string;
      readonly description?: string;
      readonly estimateHours?: number;
    }): Promise<{ id: string; key: string }> {
      const response = await post<typeof input, { created: { id: string; key: string } }>(
        "/api/t3work/atlassian/backlog/create-subtask",
        input,
      );
      return response.created;
    },

    async downloadAsset(input: {
      readonly accountId: string;
      readonly url: string;
    }): Promise<AtlassianDownloadedAsset> {
      const response = await post<typeof input, { asset: AtlassianDownloadedAsset }>(
        "/api/t3work/atlassian/asset",
        input,
      );
      return response.asset;
    },
  };
}
