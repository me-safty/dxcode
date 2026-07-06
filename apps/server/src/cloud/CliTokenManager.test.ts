import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as CliTokenManager from "./CliTokenManager.ts";
import type { PasteCodePromptInput } from "./CliTokenManager.ts";

// pk_test_<base64 of "clerk.example.test$">
const TEST_ENV = {
  T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==",
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_client_test",
  T3CODE_HOSTED_APP_URL: "https://hosted.example.test",
};

interface RecordedTokenRequest {
  readonly url: string;
  readonly params: URLSearchParams;
}

// A JWT whose payload claims { email: "theo@example.test" } (signature is not
// verified — the CLI only reads the claim to display the connected account).
const idTokenWithEmail = (() => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email: "theo@example.test" })).toString("base64url");
  return `${header}.${payload}.`;
})();

const makeTokenEndpointLayer = (requests: Array<RecordedTokenRequest>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        requests.push({ url: request.url, params: new URLSearchParams(body) });
        return HttpClientResponse.fromWeb(
          request,
          new Response(
            // @effect-diagnostics-next-line preferSchemaOverJson:off - Test fixture matches Clerk's token endpoint response.
            JSON.stringify({
              access_token: "access-token-1",
              refresh_token: "refresh-token-1",
              id_token: idTokenWithEmail,
              expires_in: 3600,
              token_type: "bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    ),
  );

const provideTestEnv = Effect.provide(
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: TEST_ENV })),
);

const isAuthorizationError = Schema.is(CliTokenManager.CloudCliAuthorizationError);

class PromptRejectedError extends Schema.TaggedErrorClass<PromptRejectedError>()(
  "PromptRejectedError",
  { message: Schema.String },
) {}

it.layer(NodeServices.layer)("CliTokenManager.pasteCodeLogin", (it) => {
  it.effect("prints a hosted authorize URL and exchanges the pasted code with PKCE", () =>
    Effect.gen(function* () {
      const requests: Array<RecordedTokenRequest> = [];
      let seenAuthorizeUrl = "";

      const { token, identity } = yield* CliTokenManager.pasteCodeLogin(
        ({ authorizeUrl, validate }: PasteCodePromptInput) =>
          Effect.gen(function* () {
            seenAuthorizeUrl = authorizeUrl;
            const request = readConnectAuthorizeRequest(new URL(authorizeUrl));
            assert.isNotNull(request);
            return yield* validate(`clerk-code-123.${request!.state}`).pipe(
              Effect.mapError((message) => new PromptRejectedError({ message })),
            );
          }),
      ).pipe(Effect.provide(makeTokenEndpointLayer(requests)), provideTestEnv);

      const authorizeUrl = new URL(seenAuthorizeUrl);
      assert.equal(authorizeUrl.origin, "https://hosted.example.test");
      assert.equal(authorizeUrl.pathname, "/connect");
      const request = readConnectAuthorizeRequest(authorizeUrl);
      assert.isNotNull(request);

      assert.equal(token.accessToken, "access-token-1");
      assert.equal(token.refreshToken, "refresh-token-1");
      // The id_token's email claim is surfaced so connect can show the account.
      assert.equal(identity, "theo@example.test");

      assert.lengthOf(requests, 1);
      const exchange = requests[0]!;
      assert.equal(exchange.url, "https://clerk.example.test/oauth/token");
      assert.equal(exchange.params.get("grant_type"), "authorization_code");
      assert.equal(exchange.params.get("code"), "clerk-code-123");
      assert.equal(
        exchange.params.get("redirect_uri"),
        "https://hosted.example.test/connect/callback",
      );
      assert.equal(exchange.params.get("client_id"), "oauth_client_test");
      // The verifier must hash to the challenge advertised in the authorize URL.
      const verifier = exchange.params.get("code_verifier");
      assert.isNotNull(verifier);
      const digest = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier!)),
      );
      assert.equal(Buffer.from(digest).toString("base64url"), request!.challenge);
    }),
  );

  it.effect("rejects pasted codes whose state does not match the request", () =>
    Effect.gen(function* () {
      const requests: Array<RecordedTokenRequest> = [];

      const validationErrors: Array<string> = [];
      const result = yield* CliTokenManager.pasteCodeLogin(({ validate }: PasteCodePromptInput) =>
        validate("clerk-code-123.wrong-state").pipe(
          Effect.tapError((message) => Effect.sync(() => validationErrors.push(message))),
          Effect.mapError((message) => new PromptRejectedError({ message })),
        ),
      ).pipe(Effect.provide(makeTokenEndpointLayer(requests)), provideTestEnv, Effect.flip);

      assert.lengthOf(requests, 0);
      assert.lengthOf(validationErrors, 1);
      assert.include(validationErrors[0], "different connect request");
      assert.instanceOf(result, PromptRejectedError);
    }),
  );

  it.effect("fails without touching the token endpoint when the prompt returns garbage", () =>
    Effect.gen(function* () {
      const requests: Array<RecordedTokenRequest> = [];

      const result = yield* CliTokenManager.pasteCodeLogin(() =>
        Effect.succeed("not-a-connect-code"),
      ).pipe(Effect.provide(makeTokenEndpointLayer(requests)), provideTestEnv, Effect.flip);

      assert.lengthOf(requests, 0);
      assert.isTrue(isAuthorizationError(result));
    }),
  );
});
