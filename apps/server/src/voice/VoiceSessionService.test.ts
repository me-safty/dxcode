import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as VoiceSessionService from "./VoiceSessionService.ts";

function makeTestLayer(
  response: (request: HttpClientRequest.HttpClientRequest) => Response = () =>
    Response.json({ value: "ephemeral-secret", expires_at: 1_800_000_000 }),
) {
  const secrets = new Map<string, Uint8Array>();
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, response(request))),
  );
  const secretStoreLayer = Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => secrets.set(name, value)).pipe(Effect.asVoid),
    remove: (name) => Effect.sync(() => secrets.delete(name)).pipe(Effect.asVoid),
  });

  return {
    execute,
    layer: VoiceSessionService.layer.pipe(
      Layer.provide(secretStoreLayer),
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    ),
  };
}

it.effect("stores xAI API keys server-side and returns only an ephemeral voice credential", () => {
  const { execute, layer } = makeTestLayer();

  return Effect.gen(function* () {
    const voice = yield* VoiceSessionService.VoiceSessionService;
    assert.deepStrictEqual(yield* voice.getCredentialStatus, { configured: false });

    assert.deepStrictEqual(yield* voice.setCredential("  xai-user-key  "), {
      configured: true,
    });
    assert.deepStrictEqual(yield* voice.getCredentialStatus, { configured: true });

    const access = yield* voice.createSession;
    assert.deepStrictEqual(access, {
      clientSecret: "ephemeral-secret",
      expiresAt: 1_800_000_000,
      websocketUrl: "wss://api.x.ai/v1/realtime?model=grok-voice-latest&reasoning.effort=high",
    });
    assert.equal(execute.mock.calls.length, 1);
    const request = execute.mock.calls[0]?.[0];
    assert.isDefined(request);
    assert.equal(request.headers.authorization, "Bearer xai-user-key");

    assert.deepStrictEqual(yield* voice.removeCredential, { configured: false });
    assert.deepStrictEqual(yield* voice.getCredentialStatus, { configured: false });
  }).pipe(Effect.provide(layer));
});

it.effect("maps xAI authentication failures without exposing the saved key", () => {
  const { layer } = makeTestLayer(() => new Response(null, { status: 401 }));

  return Effect.gen(function* () {
    const voice = yield* VoiceSessionService.VoiceSessionService;
    yield* voice.setCredential("xai-sensitive-key");
    const error = yield* Effect.flip(voice.createSession);

    assert.equal(error.reason, "credential_invalid");
    assert.notInclude(error.message, "xai-sensitive-key");
  }).pipe(Effect.provide(layer));
});
