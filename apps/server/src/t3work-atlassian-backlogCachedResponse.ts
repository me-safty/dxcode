import * as Effect from "effect/Effect";

import {
  fingerprintBacklogPayload,
  readCachedT3workAtlassianBacklog,
  type T3workAtlassianBacklogPayload,
  type T3workBacklogSelectionInput,
} from "./t3work-atlassian-backlog-cache.ts";
import {
  createCachedBacklogResponse,
  type T3workAtlassianBacklogCacheMetadata,
} from "./t3work-atlassian-backlogTypes.ts";

export function readCachedT3workAtlassianBacklogResponse(input: {
  readonly provider: string;
  readonly accountId: string;
  readonly externalProjectId: string;
  readonly selection: T3workBacklogSelectionInput;
  readonly source: "persisted" | "stale-fallback";
}) {
  return readCachedT3workAtlassianBacklog({
    provider: input.provider,
    accountId: input.accountId,
    externalProjectId: input.externalProjectId,
    selection: input.selection,
  }).pipe(
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((cached) =>
      cached
        ? createCachedBacklogResponse(cached.response, {
            source: input.source,
            updatedAt: cached.updatedAt,
            fingerprint: cached.fingerprint,
          })
        : null,
    ),
  );
}

export function createLiveT3workAtlassianBacklogResponse(input: {
  readonly payload: T3workAtlassianBacklogPayload;
  readonly updatedAt: number;
  readonly fingerprint?: string;
}) {
  return createCachedBacklogResponse(input.payload, {
    source: "live",
    updatedAt: input.updatedAt,
    fingerprint: input.fingerprint ?? fingerprintBacklogPayload(input.payload),
  } satisfies T3workAtlassianBacklogCacheMetadata);
}
