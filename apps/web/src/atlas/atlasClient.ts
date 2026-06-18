// Browser-side client for Vector's FastAPI, authenticated with the Atlas JWT the
// login gate stored (localStorage). Mirrors @atlas/backend's /api surface.
import { getAtlasToken } from "./AtlasAuthGate";

const API_URL = import.meta.env.VITE_ATLAS_API_URL?.trim();

export interface AtlasDeal {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly stage: string | undefined;
}

export function atlasApiConfigured(): boolean {
  return Boolean(API_URL);
}

/** Per-deal workspace directory on the shared volume — where the agent runs. */
export function dealWorkspaceRoot(dealId: string): string {
  return `/workspaces/${dealId}`;
}

function authHeaders(): Record<string, string> {
  const token = getAtlasToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listAtlasDeals(): Promise<ReadonlyArray<AtlasDeal>> {
  if (!API_URL) return [];
  const res = await fetch(`${API_URL}/api/deals`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha ao carregar deals (${res.status})`);
  const data = (await res.json()) as ReadonlyArray<Record<string, unknown>>;
  return (Array.isArray(data) ? data : []).map((d) => ({
    id: String(d["id"]),
    name: typeof d["name"] === "string" ? (d["name"] as string) : "Deal",
    description: typeof d["description"] === "string" ? (d["description"] as string) : undefined,
    stage: typeof d["stage"] === "string" ? (d["stage"] as string) : undefined,
  }));
}

/** Best-effort: ask FastAPI to (re)sync a deal's dataroom into its workspace. */
export async function syncAtlasDataroom(dealId: string): Promise<void> {
  if (!API_URL) return;
  await fetch(`${API_URL}/api/deals/${dealId}/dataroom/sync`, {
    method: "POST",
    headers: authHeaders(),
  }).catch(() => undefined);
}
