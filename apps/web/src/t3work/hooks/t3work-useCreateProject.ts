import { useState, useCallback } from "react";
import * as Effect from "effect/Effect";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import {
  type AtlassianAccessibleResource,
  type TokenExchangeResult,
} from "@t3tools/integrations-atlassian";
import type { ProjectShellProject } from "@t3tools/project-context";
import type { ExternalProject, IntegrationAccount } from "@t3tools/integrations-core";
import { useBackend } from "~/t3work/backend/t3work-index";
import { t3workCreateProject } from "~/t3work/t3work-mock-adapter";

const LAST_ACCOUNT_ID_STORAGE_KEY = "t3work:last-atlassian-account-id";

export type CreateProjectStep = "source" | "account" | "project" | "confirm" | "creating";

export type AtlassianBasicCredentials = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export type OAuthAccount = {
  resource: AtlassianAccessibleResource;
  token: TokenExchangeResult;
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(normalizeAtlassianUrl(value));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAtlassianUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function readLastAccountId(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLastAccountId(accountId: string): void {
  try {
    localStorage.setItem(LAST_ACCOUNT_ID_STORAGE_KEY, accountId);
  } catch {
    // Ignore storage failures in private mode or blocked environments.
  }
}

function pickPreferredAccount(
  loadedAccounts: ReadonlyArray<IntegrationAccount>,
): IntegrationAccount | null {
  const lastAccountId = readLastAccountId();
  if (!lastAccountId) return loadedAccounts[0] ?? null;
  return (
    loadedAccounts.find((account) => account.id === lastAccountId) ?? loadedAccounts[0] ?? null
  );
}

export function useCreateProject() {
  const backend = useBackend();
  const [step, setStep] = useState<CreateProjectStep>("source");
  const [accounts, setAccounts] = useState<ReadonlyArray<IntegrationAccount>>([]);
  const [selectedAccount, setSelectedAccount] = useState<IntegrationAccount | null>(null);
  const [projects, setProjects] = useState<ReadonlyArray<ExternalProject>>([]);
  const [selectedProject, setSelectedProject] = useState<ExternalProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPersistedAccounts = useCallback(async () => {
    setError(null);
    try {
      if (!backend) throw new Error("Backend not available");
      const loadedAccounts = await backend.atlassian.listAccounts();
      if (loadedAccounts.length === 0) return;
      setAccounts(loadedAccounts);
      const preferredAccount = pickPreferredAccount(loadedAccounts);
      setSelectedAccount(preferredAccount);
      setStep("account");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load saved Atlassian settings";
      setError(message);
      setStep("source");
    }
  }, [backend]);

  const loadAccountsWithOAuth = useCallback(
    async (sites: ReadonlyArray<AtlassianAccessibleResource>, token: TokenExchangeResult) => {
      setStep("account");
      setError(null);

      try {
        if (!backend) throw new Error("Backend not available");
        const loadedAccounts = await backend.atlassian.connectOAuth({ sites, token });
        setAccounts(loadedAccounts);
        setSelectedProject(null);
        if (loadedAccounts.length === 0) {
          setError("No Atlassian sites found.");
          setStep("source");
          return;
        }
        const preferredAccount = pickPreferredAccount(loadedAccounts);
        setSelectedAccount(preferredAccount);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to connect Atlassian";
        setError(message);
        setStep("source");
      }
    },
    [backend],
  );

  const loadAccountsWithBasic = useCallback(
    async (credentials: AtlassianBasicCredentials) => {
      setStep("account");
      setError(null);

      try {
        if (!backend) throw new Error("Backend not available");
        const loadedAccounts = await backend.atlassian.connectBasic({
          ...credentials,
          siteUrl: normalizeAtlassianUrl(credentials.siteUrl),
        });
        setAccounts(loadedAccounts);
        setSelectedProject(null);
        if (loadedAccounts.length === 0) {
          setError("No Atlassian sites found.");
          setStep("source");
          return;
        }
        const preferredAccount = pickPreferredAccount(loadedAccounts);
        setSelectedAccount(preferredAccount);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to connect Atlassian";
        setError(message);
        setStep("source");
      }
    },
    [backend],
  );

  const loadProjectsWithProvider = useCallback(
    async (account: IntegrationAccount) => {
      setError(null);
      try {
        if (!backend) throw new Error("Backend not available");
        setSelectedAccount(account);
        persistLastAccountId(account.id);
        setSelectedProject(null);
        const projs = await backend.atlassian.listProjects({
          id: account.id,
          provider: account.provider,
        });
        setProjects(projs);
        setStep("project");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load Jira projects";
        setError(message);
        setStep("account");
      }
    },
    [backend],
  );

  const loadProjects = useCallback(
    async (account: IntegrationAccount) => {
      await loadProjectsWithProvider(account);
    },
    [loadProjectsWithProvider],
  );

  const createProject = useCallback(
    async (externalProject: ExternalProject): Promise<ProjectShellProject> => {
      setStep("creating");
      setError(null);
      try {
        if (!backend) {
          throw new Error("Backend not available");
        }
        if (!selectedAccount) {
          throw new Error("Select an Atlassian site before creating a project.");
        }
        const project = await Effect.runPromise(
          t3workCreateProject({
            title: externalProject.title,
            sourceProvider: externalProject.provider,
            accountId: selectedAccount.id,
            externalProjectId: externalProject.id,
            ...(externalProject.key ? { externalProjectKey: externalProject.key } : {}),
            ...(externalProject.url ? { externalProjectUrl: externalProject.url } : {}),
            raw: externalProject.raw,
          }),
        );
        if (!project.workspace?.rootPath) {
          throw new Error("Created project is missing a managed workspace root.");
        }
        await backend.dispatchCommand({
          type: "project.create",
          commandId: crypto.randomUUID() as any,
          projectId: project.id as any,
          title: project.title,
          workspaceRoot: project.workspace.rootPath,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: new Date().toISOString(),
        });
        return project;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create project");
        setStep("project");
        throw e;
      }
    },
    [backend, selectedAccount],
  );

  return {
    step,
    accounts,
    selectedAccount,
    projects,
    selectedProject,
    error,
    setStep,
    setSelectedAccount,
    setSelectedProject,
    loadAccountsWithOAuth,
    loadAccountsWithBasic,
    loadPersistedAccounts,
    loadProjects,
    createProject,
    isValidUrl,
  };
}
