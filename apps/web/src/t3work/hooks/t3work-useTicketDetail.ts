import { useState, useEffect, useCallback } from "react";
import type { ProjectShellProject, ResourceSnapshot } from "@t3tools/project-context";
import { useBackend } from "~/t3work/backend/t3work-index";

export interface TicketDetail {
  snapshot: ResourceSnapshot | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useTicketDetail(project: ProjectShellProject, ticketId: string): TicketDetail {
  const backend = useBackend();
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!backend) throw new Error("Backend not available");
      if (!project.source.accountId) {
        throw new Error(
          "Missing Atlassian account for this project. Reconnect and re-add the project.",
        );
      }
      const ref = {
        id: ticketId,
        provider: project.source.provider,
        kind: "issue",
        projectId: project.source.externalProjectId,
      };
      const result = await backend.atlassian.getResource({
        accountId: project.source.accountId,
        ref,
      });
      setSnapshot(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ticket details");
    } finally {
      setLoading(false);
    }
  }, [backend, project, ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  return { snapshot, loading, error, reload: load };
}
