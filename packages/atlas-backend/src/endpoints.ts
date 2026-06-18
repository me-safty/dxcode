/**
 * Single source of truth for Vector FastAPI paths.
 *
 * Every router mounts under `/api` (see `../vector/apps/api/app/main.py`). Pure
 * string builders — no transport — so this stays dependency- and global-free and
 * is reused by the typed client (Step 4) and any direct callers.
 */

export const ATLAS_API_PREFIX = "/api" as const;

export const atlasEndpoints = {
  login: () => `${ATLAS_API_PREFIX}/auth/login`,
  me: () => `${ATLAS_API_PREFIX}/auth/me`,
  deals: () => `${ATLAS_API_PREFIX}/deals`,
  deal: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}`,
  dealAudit: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}/audit`,
  dealMembers: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}/members`,
  dealMember: (dealId: string, memberId: string) =>
    `${ATLAS_API_PREFIX}/deals/${dealId}/members/${memberId}`,
  dealFiles: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}/files`,
  dealFile: (dealId: string, path: string) =>
    `${ATLAS_API_PREFIX}/deals/${dealId}/files/${path}`,
  dataroom: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}/dataroom`,
  dataroomSync: (dealId: string) => `${ATLAS_API_PREFIX}/deals/${dealId}/dataroom/sync`,
  transcribe: () => `${ATLAS_API_PREFIX}/transcribe`,
  health: () => `${ATLAS_API_PREFIX}/health`,
  ready: () => `${ATLAS_API_PREFIX}/ready`,
} as const;
