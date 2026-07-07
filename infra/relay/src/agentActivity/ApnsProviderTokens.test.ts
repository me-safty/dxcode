import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as RelayDb from "../db.ts";
import * as ApnsProviderTokens from "./ApnsProviderTokens.ts";

const { privateKey } = NodeCrypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const signingInput = {
  teamId: "team-1",
  keyId: "key-1",
  privateKey: Redacted.make(privateKey),
};

interface StoredRow {
  jwt: string;
  issuedAt: number;
}

function makeFakeDb(input: {
  readonly stored: StoredRow | null;
  readonly onPublish?: (values: Record<string, unknown>) => StoredRow;
  readonly failReads?: boolean;
}) {
  const calls: Array<string> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          calls.push("select");
          return input.failReads
            ? Effect.die("database unavailable")
            : Effect.succeed(input.stored ? [input.stored] : []);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            calls.push("insert");
            if (input.failReads) {
              return Effect.die("database unavailable");
            }
            const row = input.onPublish
              ? input.onPublish(values)
              : { jwt: values.jwt as string, issuedAt: values.issuedAt as number };
            return Effect.succeed([row]);
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as RelayDb.RelayDb["Service"], calls };
}

function testLayer(db: RelayDb.RelayDb["Service"]) {
  return ApnsProviderTokens.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, db)));
}

describe("ApnsProviderTokens", () => {
  it.effect("adopts a fresh shared token from the database without signing", () => {
    ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    const { db, calls } = makeFakeDb({ stored: { jwt: "shared-jwt", issuedAt: 1_000 } });
    return Effect.gen(function* () {
      const tokens = yield* ApnsProviderTokens.ApnsProviderTokens;
      const jwt = yield* tokens.getJwt({ ...signingInput, issuedAtUnixSeconds: 1_100 });
      expect(jwt).toBe("shared-jwt");
      expect(calls).toEqual(["select"]);

      // Second call is served from the isolate cache without touching the db.
      const again = yield* tokens.getJwt({ ...signingInput, issuedAtUnixSeconds: 1_200 });
      expect(again).toBe("shared-jwt");
      expect(calls).toEqual(["select"]);
      ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    }).pipe(Effect.provide(testLayer(db)));
  });

  it.effect("mints and publishes when the shared token is stale", () => {
    ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    const staleIssuedAt = 1_000;
    const now = staleIssuedAt + ApnsProviderTokens.APNS_JWT_REUSE_SECONDS + 1;
    const { db, calls } = makeFakeDb({ stored: { jwt: "stale-jwt", issuedAt: staleIssuedAt } });
    return Effect.gen(function* () {
      const tokens = yield* ApnsProviderTokens.ApnsProviderTokens;
      const jwt = yield* tokens.getJwt({ ...signingInput, issuedAtUnixSeconds: now });
      expect(jwt).not.toBe("stale-jwt");
      expect(jwt.split(".")).toHaveLength(3);
      expect(calls).toEqual(["select", "insert"]);
      ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    }).pipe(Effect.provide(testLayer(db)));
  });

  it.effect("adopts a concurrent refresher's newer token from the upsert result", () => {
    ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    const { db } = makeFakeDb({
      stored: null,
      onPublish: () => ({ jwt: "winner-jwt", issuedAt: 2_000 }),
    });
    return Effect.gen(function* () {
      const tokens = yield* ApnsProviderTokens.ApnsProviderTokens;
      const jwt = yield* tokens.getJwt({ ...signingInput, issuedAtUnixSeconds: 2_000 });
      expect(jwt).toBe("winner-jwt");
      ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    }).pipe(Effect.provide(testLayer(db)));
  });

  it.effect("falls back to a locally minted token when the database is unavailable", () => {
    ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    const { db } = makeFakeDb({ stored: null, failReads: true });
    return Effect.gen(function* () {
      const tokens = yield* ApnsProviderTokens.ApnsProviderTokens;
      const jwt = yield* tokens.getJwt({ ...signingInput, issuedAtUnixSeconds: 3_000 });
      expect(jwt.split(".")).toHaveLength(3);
      ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    }).pipe(Effect.provide(testLayer(db)));
  });
});
