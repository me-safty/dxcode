import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  VoiceApiError,
  type VoiceCredentialStatus,
  type VoiceSessionAccess,
} from "@t3tools/contracts";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

const XAI_VOICE_API_KEY_SECRET = "xai-voice-api-key";
const XAI_CLIENT_SECRET_URL = "https://api.x.ai/v1/realtime/client_secrets";
const XAI_VOICE_WEBSOCKET_URL =
  "wss://api.x.ai/v1/realtime?model=grok-voice-latest&reasoning.effort=high";

const XaiClientSecretResponse = Schema.Struct({
  value: Schema.String,
  expires_at: Schema.Number,
});

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function secretStoreFailure(): VoiceApiError {
  return new VoiceApiError({
    reason: "secret_store_failed",
    message: "T3 Code could not access the saved xAI voice credential.",
  });
}

export class VoiceSessionService extends Context.Service<
  VoiceSessionService,
  {
    readonly getCredentialStatus: Effect.Effect<VoiceCredentialStatus, VoiceApiError>;
    readonly setCredential: (apiKey: string) => Effect.Effect<VoiceCredentialStatus, VoiceApiError>;
    readonly removeCredential: Effect.Effect<VoiceCredentialStatus, VoiceApiError>;
    readonly createSession: Effect.Effect<VoiceSessionAccess, VoiceApiError>;
  }
>()("t3/voice/VoiceSessionService") {}

export const make = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;

  const readCredential = secretStore
    .get(XAI_VOICE_API_KEY_SECRET)
    .pipe(Effect.mapError(secretStoreFailure), Effect.map(Option.map(bytesToString)));

  const getCredentialStatus = readCredential.pipe(
    Effect.map((credential) => ({ configured: Option.isSome(credential) })),
    Effect.withSpan("VoiceSessionService.getCredentialStatus"),
  );

  const setCredential: VoiceSessionService["Service"]["setCredential"] = Effect.fn(
    "VoiceSessionService.setCredential",
  )(function* (apiKey) {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      return yield* new VoiceApiError({
        reason: "credential_invalid",
        message: "Enter a non-empty xAI API key.",
      });
    }
    yield* secretStore
      .set(XAI_VOICE_API_KEY_SECRET, stringToBytes(trimmed))
      .pipe(Effect.mapError(secretStoreFailure));
    return { configured: true };
  });

  const removeCredential = secretStore
    .remove(XAI_VOICE_API_KEY_SECRET)
    .pipe(
      Effect.mapError(secretStoreFailure),
      Effect.as({ configured: false }),
      Effect.withSpan("VoiceSessionService.removeCredential"),
    );

  const createSession = Effect.gen(function* () {
    const credential = yield* readCredential;
    if (Option.isNone(credential)) {
      return yield* new VoiceApiError({
        reason: "credential_not_configured",
        message: "Add an xAI API key in Voice settings before starting a voice session.",
      });
    }

    const request = yield* HttpClientRequest.post(XAI_CLIENT_SECRET_URL).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${credential.value}`),
      HttpClientRequest.setHeader("content-type", "application/json"),
      HttpClientRequest.bodyJson({ expires_after: { seconds: 300 } }),
      Effect.mapError(
        () =>
          new VoiceApiError({
            reason: "upstream_unavailable",
            message: "T3 Code could not prepare the xAI voice request.",
          }),
      ),
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.mapError(
        () =>
          new VoiceApiError({
            reason: "upstream_unavailable",
            message: "T3 Code could not reach the xAI Voice API.",
          }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new VoiceApiError({
        reason:
          response.status === 401 || response.status === 403
            ? "credential_invalid"
            : "upstream_unavailable",
        message:
          response.status === 401 || response.status === 403
            ? "xAI rejected this API key. Check the key and its team permissions."
            : `xAI could not create a voice session (HTTP ${response.status}).`,
      });
    }

    const result = yield* HttpClientResponse.schemaBodyJson(XaiClientSecretResponse)(response).pipe(
      Effect.mapError(
        () =>
          new VoiceApiError({
            reason: "upstream_unavailable",
            message: "xAI returned an invalid voice-session credential.",
          }),
      ),
    );
    return {
      clientSecret: result.value,
      expiresAt: result.expires_at,
      websocketUrl: XAI_VOICE_WEBSOCKET_URL,
    };
  }).pipe(Effect.withSpan("VoiceSessionService.createSession"));

  return {
    getCredentialStatus,
    setCredential,
    removeCredential,
    createSession,
  } satisfies VoiceSessionService["Service"];
});

export const layer = Layer.effect(VoiceSessionService, make);
