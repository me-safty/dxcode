import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { eq, sql } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayApnsProviderTokens } from "../persistence/schema.ts";
import {
  apnsProviderTokenCacheKey,
  makeApnsJwt,
  type ApnsJwtError,
  type ApnsJwtSigningInput,
} from "./apnsJwt.ts";

// APNs requires REUSING the provider token: refreshing it more than roughly
// once per 20 minutes returns 429 TooManyProviderTokenUpdates and drops the
// push (observed live: bursty Live Activity updates got 429'd, leaving stale
// lock-screen state). Reuse each signed JWT for most of its 60-minute
// validity.
export const APNS_JWT_REUSE_SECONDS = 45 * 60;

export class ApnsProviderTokens extends Context.Service<
  ApnsProviderTokens,
  {
    readonly getJwt: (input: ApnsJwtSigningInput) => Effect.Effect<string, ApnsJwtError>;
  }
>()("t3code-relay/agentActivity/ApnsProviderTokens") {}

interface CachedProviderToken {
  readonly jwt: string;
  readonly issuedAtUnixSeconds: number;
}

// Per-isolate fast path in front of the shared database row. Worker isolates
// come and go, so this alone cannot keep the token stable fleet-wide — the
// database row is the source of truth all isolates converge on.
const isolateTokenCache = new Map<string, CachedProviderToken>();

export function __resetApnsProviderTokenCacheForTest(): void {
  isolateTokenCache.clear();
}

function isReusable(cached: CachedProviderToken, nowUnixSeconds: number): boolean {
  return (
    nowUnixSeconds >= cached.issuedAtUnixSeconds &&
    nowUnixSeconds - cached.issuedAtUnixSeconds < APNS_JWT_REUSE_SECONDS
  );
}

const makeInMemory = Effect.sync(() =>
  ApnsProviderTokens.of({
    getJwt: Effect.fnUntraced(function* (input) {
      const cacheKey = apnsProviderTokenCacheKey(input);
      const cached = isolateTokenCache.get(cacheKey);
      if (cached && isReusable(cached, input.issuedAtUnixSeconds)) {
        return cached.jwt;
      }
      const jwt = yield* makeApnsJwt(input);
      isolateTokenCache.set(cacheKey, { jwt, issuedAtUnixSeconds: input.issuedAtUnixSeconds });
      return jwt;
    }),
  }),
);

const makeDatabase = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  const readSharedToken = Effect.fnUntraced(function* (cacheKey: string) {
    return yield* db
      .select({
        jwt: relayApnsProviderTokens.jwt,
        issuedAt: relayApnsProviderTokens.issuedAt,
      })
      .from(relayApnsProviderTokens)
      .where(eq(relayApnsProviderTokens.cacheKey, cacheKey))
      .pipe(
        Effect.map((rows) => rows[0] ?? null),
        Effect.catchCause((cause) =>
          Effect.logWarning("APNs provider token read failed; minting locally", { cause }).pipe(
            Effect.as(null),
          ),
        ),
      );
  });

  // Newest-wins upsert: when two isolates refresh concurrently the row keeps
  // the most recently issued token and both callers adopt whatever won, so
  // APNs sees a single stable token instead of isolates alternating theirs.
  const publishSharedToken = Effect.fnUntraced(function* (
    cacheKey: string,
    minted: CachedProviderToken,
  ) {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    return yield* db
      .insert(relayApnsProviderTokens)
      .values({
        cacheKey,
        jwt: minted.jwt,
        issuedAt: minted.issuedAtUnixSeconds,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: relayApnsProviderTokens.cacheKey,
        set: {
          jwt: sql`CASE
              WHEN ${relayApnsProviderTokens.issuedAt} < excluded.issued_at THEN excluded.jwt
              ELSE ${relayApnsProviderTokens.jwt}
            END`,
          issuedAt: sql`GREATEST(${relayApnsProviderTokens.issuedAt}, excluded.issued_at)`,
          updatedAt,
        },
      })
      .returning({
        jwt: relayApnsProviderTokens.jwt,
        issuedAt: relayApnsProviderTokens.issuedAt,
      })
      .pipe(
        Effect.map((rows) => rows[0] ?? null),
        Effect.catchCause((cause) =>
          Effect.logWarning("APNs provider token publish failed; using local token", {
            cause,
          }).pipe(Effect.as(null)),
        ),
      );
  });

  return ApnsProviderTokens.of({
    getJwt: Effect.fn("relay.apns.get_provider_jwt")(function* (input) {
      const cacheKey = apnsProviderTokenCacheKey(input);
      const cached = isolateTokenCache.get(cacheKey);
      if (cached && isReusable(cached, input.issuedAtUnixSeconds)) {
        return cached.jwt;
      }

      const stored = yield* readSharedToken(cacheKey);
      if (stored) {
        const sharedToken = { jwt: stored.jwt, issuedAtUnixSeconds: stored.issuedAt };
        if (isReusable(sharedToken, input.issuedAtUnixSeconds)) {
          yield* Effect.annotateCurrentSpan({ "relay.apns.provider_token": "shared" });
          isolateTokenCache.set(cacheKey, sharedToken);
          return sharedToken.jwt;
        }
      }

      const jwt = yield* makeApnsJwt(input);
      const minted = { jwt, issuedAtUnixSeconds: input.issuedAtUnixSeconds };
      const published = yield* publishSharedToken(cacheKey, minted);
      const winner =
        published &&
        isReusable(
          { jwt: published.jwt, issuedAtUnixSeconds: published.issuedAt },
          input.issuedAtUnixSeconds,
        )
          ? { jwt: published.jwt, issuedAtUnixSeconds: published.issuedAt }
          : minted;
      yield* Effect.annotateCurrentSpan({
        "relay.apns.provider_token": winner === minted ? "minted" : "adopted",
      });
      isolateTokenCache.set(cacheKey, winner);
      return winner.jwt;
    }),
  });
});

/** In-memory-only variant for tests and non-worker harnesses. */
export const layerInMemory = Layer.effect(ApnsProviderTokens, makeInMemory);

export const layer = Layer.effect(ApnsProviderTokens, makeDatabase);
