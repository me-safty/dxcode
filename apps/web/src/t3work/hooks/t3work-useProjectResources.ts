import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  ExternalResourceRef,
  ProjectShellProject,
  ResourcePage,
} from "@t3tools/project-context";
import type { ProjectTicket } from "~/t3work/t3work-types";
import { useBackend } from "~/t3work/backend/t3work-index";

function resourceToTicket(projectId: string, ref: ExternalResourceRef): ProjectTicket {
  const resourceWithParent = ref as ExternalResourceRef & { parentId?: unknown };

  return {
    id: ref.id,
    projectId,
    ...(typeof resourceWithParent.parentId === "string"
      ? { parentId: resourceWithParent.parentId }
      : {}),
    ref: {
      provider: ref.provider,
      kind: ref.kind,
      id: ref.id,
      displayId: ref.displayId ?? ref.id,
      title: ref.title,
      url: ref.url ?? "",
      projectId: ref.projectId ?? "",
      ...(ref.type !== undefined ? { type: ref.type } : {}),
    },
    ...(ref.type !== undefined ? { issueType: ref.type } : {}),
    ...(ref.issueTypeIconUrl !== undefined ? { issueTypeIconUrl: ref.issueTypeIconUrl } : {}),
    status: ref.status ?? "Unknown",
    ...(ref.assignee !== undefined ? { assignee: ref.assignee } : {}),
    ...(ref.priority !== undefined ? { priority: ref.priority } : {}),
    updatedAt: ref.updatedAt ?? new Date().toISOString(),
  };
}

export function useProjectResources(project: ProjectShellProject) {
  const backend = useBackend();
  const [resources, setResources] = useState<ResourcePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project.source.externalProjectId) return;
    if (!project.source.accountId) {
      setResources(null);
      setError("Missing Atlassian account for this project. Reconnect and re-add the project.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (!backend) throw new Error("Backend not available");
      const page = await backend.atlassian.listResources({
        account: {
          id: project.source.accountId,
          provider: project.source.provider,
        },
        externalProjectId: project.source.externalProjectId,
      });
      setResources(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [
    backend,
    project.source.externalProjectId,
    project.source.accountId,
    project.source.provider,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const tickets = useMemo(() => {
    if (!resources) return [];
    return resources.items.map((ref) => resourceToTicket(project.id, ref));
  }, [resources, project.id]);

  return { resources, tickets, loading, error, reload: load };
}
