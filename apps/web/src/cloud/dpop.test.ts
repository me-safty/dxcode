import { verifyDpopProof } from "@t3tools/shared/dpop";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decodeJwt } from "jose";
import { vi } from "vite-plus/test";

import {
  browserCryptoLayer,
  BrowserDpopKeyError,
  BrowserDpopProofError,
  createBrowserDpopProof,
  generateBrowserDpopKey,
  isBrowserDpopError,
} from "./dpop";

describe("browser DPoP proofs", () => {
  it.effect("signs relay resource proofs with an access-token hash", () =>
    Effect.gen(function* () {
      vi.stubGlobal("indexedDB", undefined);
      const proofKey = yield* generateBrowserDpopKey;
      const proof = yield* createBrowserDpopProof({
        method: "POST",
        url: "https://relay.example.test/v1/environments/env-1/connect?ignored=true",
        accessToken: "relay-access-token",
        proofKey,
      }).pipe(Effect.provide(browserCryptoLayer));
      const issuedAt = decodeJwt(proof.proof).iat;
      expect(issuedAt).toBeTypeOf("number");

      expect(
        verifyDpopProof({
          proof: proof.proof,
          method: "POST",
          url: "https://relay.example.test/v1/environments/env-1/connect",
          expectedThumbprint: proof.thumbprint,
          expectedAccessToken: "relay-access-token",
          nowEpochSeconds: issuedAt!,
        }),
      ).toMatchObject({ ok: true });
    }),
  );

  it.effect("preserves invalid proof URL request context and the parser cause", () =>
    Effect.gen(function* () {
      const proofKey = yield* generateBrowserDpopKey;
      const error = yield* createBrowserDpopProof({
        method: "POST",
        url: "http://",
        proofKey,
      }).pipe(Effect.provide(browserCryptoLayer), Effect.flip);

      expect(error).toBeInstanceOf(BrowserDpopProofError);
      expect(error).toMatchObject({
        operation: "normalize-url",
        method: "POST",
        url: "http://",
        thumbprint: proofKey.thumbprint,
      });
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.message).not.toContain((error.cause as Error).message);
      expect(isBrowserDpopError(error)).toBe(true);
    }),
  );

  it.effect("preserves the browser crypto cause when key generation fails", () =>
    Effect.gen(function* () {
      const cause = new Error("browser crypto unavailable");
      const generateKey = vi
        .spyOn(globalThis.crypto.subtle, "generateKey")
        .mockRejectedValueOnce(cause);

      const error = yield* generateBrowserDpopKey.pipe(Effect.flip);

      expect(error).toBeInstanceOf(BrowserDpopKeyError);
      expect(error.operation).toBe("generate");
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(cause.message);
      generateKey.mockRestore();
    }),
  );
});
