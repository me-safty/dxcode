import { useEffect, useMemo, useState } from "react";
import type { ProjectShellProject } from "@t3tools/project-context";
import { readLocalApi } from "~/localApi";
import { useBackend } from "~/t3work/backend/t3work-index";
import {
  groupGitHubActivityByWorkItem,
  parseGitHubHostFromDiscovery,
  parseOptionString,
  toGitHubWorkActivityItems,
  type GitHubWorkActivityItem,
} from "~/t3work/t3work-githubActivity";
import {
  normalizeCacheList,
  readIntegrationCache,
  writeIntegrationCache,
} from "./t3work-integrationCache";

type ProjectGitHubActivityCache = {
  readonly host: string;
  readonly account?: string;
  readonly warning?: string;
  readonly suggestedRepositoryCount: number;
  readonly activityItems: ReadonlyArray<GitHubWorkActivityItem>;
};

type UseProjectGitHubActivityOptions = {
  readonly project: ProjectShellProject;
  readonly linkedRepositoryUrls: ReadonlyArray<string>;
  readonly enabled?: boolean;
};

export function useProjectGitHubActivity({
  project,
  linkedRepositoryUrls,
  enabled = true,
}: UseProjectGitHubActivityOptions) {
  const backend = useBackend();
  const cacheKey = useMemo(
    () =>
      `github:projectActivity:${project.id}:${project.source.externalProjectKey ?? "none"}:${project.title}:${normalizeCacheList(linkedRepositoryUrls)}`,
    [linkedRepositoryUrls, project.id, project.source.externalProjectKey, project.title],
  );
  const cached = readIntegrationCache<ProjectGitHubActivityCache>(cacheKey)?.value;
  const [loading, setLoading] = useState(false);
  const [host, setHost] = useState<string>(cached?.host ?? "github.com");
  const [account, setAccount] = useState<string | undefined>(cached?.account);
  const [warning, setWarning] = useState<string | undefined>(cached?.warning);
  const [suggestedRepositoryCount, setSuggestedRepositoryCount] = useState(
    cached?.suggestedRepositoryCount ?? 0,
  );
  const [activityItems, setActivityItems] = useState<ReadonlyArray<GitHubWorkActivityItem>>(
    cached?.activityItems ?? [],
  );

  useEffect(() => {
    const cachedValue = readIntegrationCache<ProjectGitHubActivityCache>(cacheKey)?.value;
    setHost(cachedValue?.host ?? "github.com");
    setAccount(cachedValue?.account);
    setWarning(cachedValue?.warning);
    setSuggestedRepositoryCount(cachedValue?.suggestedRepositoryCount ?? 0);
    setActivityItems(cachedValue?.activityItems ?? []);
  }, [cacheKey]);

  useEffect(() => {
    if (!backend) return;
    if (!enabled) {
      setLoading(false);
      setAccount(undefined);
      setWarning(undefined);
      setSuggestedRepositoryCount(0);
      setActivityItems([]);
      return;
    }

    const cachedValue = readIntegrationCache<ProjectGitHubActivityCache>(cacheKey)?.value;
    if (cachedValue) {
      setHost(cachedValue.host);
      setAccount(cachedValue.account);
      setWarning(cachedValue.warning);
      setSuggestedRepositoryCount(cachedValue.suggestedRepositoryCount);
      setActivityItems(cachedValue.activityItems);
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        let resolvedHost = "github.com";
        let discoveredAccount: string | undefined;
        const localApi = readLocalApi();
        if (localApi) {
          const discovery = await localApi.server.discoverSourceControl();
          resolvedHost = parseGitHubHostFromDiscovery(discovery);
          const githubProvider = discovery.sourceControlProviders.find(
            (provider) => provider.kind === "github",
          );
          discoveredAccount = githubProvider
            ? parseOptionString(githubProvider.auth.account)
            : undefined;
        }

        const response = await backend.github.discoverInbox({
          host: resolvedHost,
          ...(project.source.externalProjectKey
            ? { projectKey: project.source.externalProjectKey }
            : {}),
          ...(project.title ? { projectTitle: project.title } : {}),
          linkedRepositoryUrls,
        });

        if (cancelled) return;
        const nextAccount = response.account ?? discoveredAccount;
        const nextCache: ProjectGitHubActivityCache = {
          host: response.host || resolvedHost,
          ...(nextAccount !== undefined ? { account: nextAccount } : {}),
          ...(response.inboxWarning ? { warning: response.inboxWarning } : {}),
          suggestedRepositoryCount: response.suggestedRepositoryUrls.length,
          activityItems: toGitHubWorkActivityItems(response.inboxItems),
        };
        writeIntegrationCache(cacheKey, nextCache);
        setHost(nextCache.host);
        setAccount(nextCache.account);
        setWarning(nextCache.warning);
        setSuggestedRepositoryCount(nextCache.suggestedRepositoryCount);
        setActivityItems(nextCache.activityItems);
      } catch (error) {
        if (cancelled) return;
        setWarning(error instanceof Error ? error.message : "Unable to load GitHub activity");
        setActivityItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    backend,
    cacheKey,
    enabled,
    linkedRepositoryUrls,
    project.source.externalProjectKey,
    project.title,
  ]);

  const activityByWorkItem = useMemo(
    () => groupGitHubActivityByWorkItem(activityItems),
    [activityItems],
  );

  const unlinkedActivityItems = useMemo(
    () => activityItems.filter((item) => !item.workItemKey),
    [activityItems],
  );

  return {
    loading,
    host,
    account,
    warning,
    suggestedRepositoryCount,
    activityItems,
    activityByWorkItem,
    unlinkedActivityItems,
  };
}
