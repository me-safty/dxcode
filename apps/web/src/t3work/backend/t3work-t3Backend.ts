import { type ClientOrchestrationCommand, type ServerConfigStreamEvent } from "@t3tools/contracts";
import type {
  ExternalProject,
  IntegrationAccount,
  IntegrationAccountRef,
} from "@t3tools/integrations-core";
import type { ResourcePage, ResourceSnapshot } from "@t3tools/project-context";
import { readEnvironmentApi } from "~/environmentApi";
import { getPrimaryKnownEnvironment } from "~/environments/primary";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { getServerConfig } from "~/rpc/serverState";
import type {
  AtlassianBasicConnectInput,
  AtlassianOAuthConnectInput,
  BackendApi,
  BackendState,
} from "./t3work-types";

function resolveWsUrl(rawUrl: string): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol === "http:") resolved.protocol = "ws:";
  else if (resolved.protocol === "https:") resolved.protocol = "wss:";
  resolved.pathname = "/ws";
  return resolved.toString();
}

function resolveHttpBaseUrl(rawUrl: string): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol === "ws:") resolved.protocol = "http:";
  else if (resolved.protocol === "wss:") resolved.protocol = "https:";

  if (resolved.pathname === "/ws") {
    resolved.pathname = "/";
  }

  if (!resolved.pathname.endsWith("/")) {
    resolved.pathname = `${resolved.pathname}/`;
  }

  return resolved.toString();
}

async function postJson<TInput extends object, TResponse>(
  httpBaseUrl: string,
  path: string,
  body: TInput,
): Promise<TResponse> {
  const url = new URL(path, httpBaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | TResponse
    | null;

  if (!response.ok) {
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  if (!payload) {
    throw new Error("Empty response from backend.");
  }

  return payload as TResponse;
}

export function createT3Backend(wsBaseUrl: string): BackendApi {
  const httpBaseUrl = resolveHttpBaseUrl(wsBaseUrl);

  function readPrimaryOrThrow() {
    const environmentId = getPrimaryKnownEnvironment()?.environmentId;
    if (!environmentId) {
      throw new Error("Primary environment is not available.");
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      throw new Error("Primary environment API is not available.");
    }

    return api;
  }

  const state: BackendState = {
    connectionStatus: "connecting",
    serverConfig: getServerConfig(),
    providers: getServerConfig()?.providers ?? [],
    error: null,
  };

  async function connect() {
    try {
      resolveWsUrl(wsBaseUrl);
      await getPrimaryEnvironmentConnection().ensureBootstrapped();

      const nextState = state as Writable<BackendState>;
      nextState.connectionStatus = "connected";
      nextState.serverConfig = getServerConfig();
      nextState.providers = getServerConfig()?.providers ?? [];
      nextState.error = null;
    } catch (error) {
      const nextState = state as Writable<BackendState>;
      nextState.connectionStatus = "error";
      nextState.error = error instanceof Error ? error.message : String(error);
    }
  }

  async function disconnect() {
    const nextState = state as Writable<BackendState>;
    nextState.connectionStatus = "connecting";
  }

  async function dispatch(command: ClientOrchestrationCommand) {
    const api = readPrimaryOrThrow();
    await api.orchestration.dispatchCommand(command);
  }

  const atlassian = {
    async listAccounts(): Promise<ReadonlyArray<IntegrationAccount>> {
      const response = await postJson<object, { accounts: ReadonlyArray<IntegrationAccount> }>(
        httpBaseUrl,
        "/api/t3work/atlassian/accounts",
        {},
      );
      return response.accounts;
    },

    async connectBasic(
      input: AtlassianBasicConnectInput,
    ): Promise<ReadonlyArray<IntegrationAccount>> {
      const response = await postJson<
        { auth: { kind: "basic"; siteUrl: string; email: string; apiToken: string } },
        { accounts: ReadonlyArray<IntegrationAccount> }
      >(httpBaseUrl, "/api/t3work/atlassian/connect/basic", {
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
      const response = await postJson<
        {
          auth: {
            kind: "oauth";
            sites: AtlassianOAuthConnectInput["sites"];
            token: AtlassianOAuthConnectInput["token"];
          };
        },
        { accounts: ReadonlyArray<IntegrationAccount> }
      >(httpBaseUrl, "/api/t3work/atlassian/connect/oauth", {
        auth: {
          kind: "oauth",
          sites: input.sites,
          token: input.token,
        },
      });
      return response.accounts;
    },

    async listProjects(account: IntegrationAccountRef): Promise<ReadonlyArray<ExternalProject>> {
      const response = await postJson<
        IntegrationAccountRef,
        { projects: ReadonlyArray<ExternalProject> }
      >(httpBaseUrl, "/api/t3work/atlassian/projects", account);
      return response.projects;
    },

    async listResources(input: {
      readonly account: IntegrationAccountRef;
      readonly externalProjectId: string;
      readonly limit?: number;
    }): Promise<ResourcePage> {
      const response = await postJson<typeof input, { page: ResourcePage }>(
        httpBaseUrl,
        "/api/t3work/atlassian/resources",
        input,
      );
      return response.page;
    },

    async getResource(input: {
      readonly accountId: string;
      readonly ref: unknown;
    }): Promise<ResourceSnapshot> {
      const response = await postJson<typeof input, { snapshot: ResourceSnapshot }>(
        httpBaseUrl,
        "/api/t3work/atlassian/resource",
        input,
      );
      return response.snapshot;
    },
  };

  return {
    get state() {
      return state;
    },
    connect,
    disconnect,
    dispatchCommand: dispatch,
    atlassian,
    subscribeConfig(listener: (event: ServerConfigStreamEvent) => void) {
      return getPrimaryEnvironmentConnection().client.server.subscribeConfig(listener);
    },
    subscribeLifecycle(listener: (event: unknown) => void) {
      return getPrimaryEnvironmentConnection().client.server.subscribeLifecycle(listener as never);
    },
    subscribeShell(listener: (event: unknown) => void) {
      const api = readPrimaryOrThrow();
      return api.orchestration.subscribeShell(listener as never);
    },
    subscribeThread(threadId: string, listener: (event: unknown) => void) {
      const api = readPrimaryOrThrow();
      return api.orchestration.subscribeThread({ threadId: threadId as never }, listener as never);
    },
  };
}

type Writable<T> = {
  -readonly [K in keyof T]: T[K];
};
