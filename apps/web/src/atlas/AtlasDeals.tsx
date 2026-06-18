// Atlas Vector deals surface (Step 5): lists the user's FastAPI deals and opens
// the selected one as a T3 project rooted at its shared workspace dir
// (/workspaces/<deal_id>), giving the agent filesystem access to the dataroom.
// Mirrors the project.create flow in components/CommandPalette.tsx. Mounted from
// __root.tsx; renders nothing when Atlas isn't configured.
import { scopeProjectRef } from "@t3tools/client-runtime";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { readEnvironmentApi } from "../environmentApi";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { findProjectByPath } from "../lib/projectPaths";
import { newCommandId, newProjectId } from "../lib/utils";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import {
  atlasApiConfigured,
  dealWorkspaceRoot,
  listAtlasDeals,
  type AtlasDeal,
} from "./atlasClient";

export function AtlasDeals() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const { handleNewThread } = useHandleNewThread();

  const [open, setOpen] = useState(false);
  const [deals, setDeals] = useState<ReadonlyArray<AtlasDeal> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Guide the user to a deal when there's no project open yet.
  useEffect(() => {
    if (projects.length === 0) setOpen(true);
  }, [projects.length]);

  // Load deals when the panel opens (once).
  useEffect(() => {
    if (!open || deals !== null) return;
    let cancelled = false;
    void listAtlasDeals().then(
      (loaded) => {
        if (!cancelled) setDeals(loaded);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar deals");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, deals]);

  const openDeal = useCallback(
    async (deal: AtlasDeal) => {
      if (!primaryEnvironmentId) return;
      setBusyId(deal.id);
      setError(null);
      try {
        const cwd = dealWorkspaceRoot(deal.id);
        const envProjects = projects.filter(
          (project) => project.environmentId === primaryEnvironmentId,
        );
        let projectId = findProjectByPath(envProjects, cwd)?.id;
        if (!projectId) {
          projectId = newProjectId();
          const api = readEnvironmentApi(primaryEnvironmentId);
          if (!api) throw new Error("Ambiente do agente ainda não está conectado");
          await api.orchestration.dispatchCommand({
            type: "project.create",
            commandId: newCommandId(),
            projectId,
            title: deal.name,
            workspaceRoot: cwd,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
            createdAt: new Date().toISOString(),
          });
        }
        setOpen(false);
        await handleNewThread(scopeProjectRef(primaryEnvironmentId, projectId), {}).catch(
          () => undefined,
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erro ao abrir o deal");
      } finally {
        setBusyId(null);
      }
    },
    [primaryEnvironmentId, projects, handleNewThread],
  );

  if (!atlasApiConfigured()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-40 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md transition-opacity hover:opacity-90"
      >
        Deals
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Seus deals</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Fechar
              </button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {deals === null ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum deal disponível.</p>
            ) : (
              <ul className="space-y-2">
                {deals.map((deal) => (
                  <li key={deal.id}>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void openDeal(deal)}
                      className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-ring disabled:opacity-60"
                    >
                      <span className="font-medium">{deal.name}</span>
                      {deal.stage ? (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                          {busyId === deal.id ? "Abrindo…" : deal.stage}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
