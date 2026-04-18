/**
 * Provider HTTP routes - provider-specific auth/setup endpoints that sit
 * alongside the WebSocket provider stream.
 *
 * Currently exposes `/api/provider/pi/login`, which spawns the pi CLI in a
 * new terminal window so the user can run `/login` and complete pi's OAuth
 * flow. We do not automate `/login` itself — the PiProvider watches pi's
 * auth.json and refreshes the snapshot the moment a new session appears.
 *
 * @module provider/http
 */
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  detectPiAuth,
  findPiBackendOption,
  PI_BACKEND_OPTIONS,
  readPiOAuthKeys,
  resolvePiAuthFilePath,
  spawnPiLoginTerminal,
} from "./piRuntime.ts";

const PiLoginRequest = Schema.Struct({
  backendId: Schema.String,
});

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Only owner sessions can trigger provider login.",
      status: 403,
    });
  }
  return session;
});

export const providerPiBackendsRouteLayer = HttpRouter.add(
  "GET",
  "/api/provider/pi/backends",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;

    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const defaultProvider = settings.providers.pi.defaultProvider;

    const oauthKeys = readPiOAuthKeys(resolvePiAuthFilePath(process.env));
    const auth = detectPiAuth({
      defaultProvider,
      env: process.env,
      oauthKeys,
    });
    const activeBackendIds = new Set(auth.availableBackends.map((option) => option.id));

    const backends = PI_BACKEND_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      envVars: option.envVars,
      oauthKeys: option.oauthKeys,
      setupHint: option.setupHint,
      loggedIn: activeBackendIds.has(option.id),
    }));

    return HttpServerResponse.jsonUnsafe(
      {
        defaultProvider,
        backends,
      },
      { status: 200 },
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status ?? 401 }),
      ),
    ),
  ),
);

export const providerPiLoginRouteLayer = HttpRouter.add(
  "POST",
  "/api/provider/pi/login",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;

    const body = yield* HttpServerRequest.schemaBodyJson(PiLoginRequest).pipe(
      Effect.mapError(
        () =>
          new AuthError({
            message: "Invalid pi login request payload.",
            status: 400,
          }),
      ),
    );

    const backend = findPiBackendOption(body.backendId);
    if (!backend) {
      return HttpServerResponse.jsonUnsafe(
        { error: `Unknown pi backend: ${body.backendId}` },
        { status: 400 },
      );
    }

    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const binaryPath = settings.providers.pi.binaryPath;

    const result = yield* Effect.promise(() =>
      spawnPiLoginTerminal({ backendLabel: backend.label, binaryPath }),
    );

    return HttpServerResponse.jsonUnsafe(
      {
        launched: result.launched,
        message: result.message,
        fallbackCommand: result.fallbackCommand,
        backend: {
          id: backend.id,
          label: backend.label,
        },
      },
      { status: 200 },
    );
  }).pipe(
    Effect.catchTag("AuthError", (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status ?? 401 }),
      ),
    ),
  ),
);
