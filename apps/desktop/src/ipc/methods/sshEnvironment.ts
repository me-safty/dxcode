import {
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
  DesktopDiscoveredSshHostSchema,
  DesktopSshBearerBootstrapInputSchema,
  DesktopSshBearerRequestInputSchema,
  DesktopSshEnvironmentEnsureInputSchema,
  DesktopSshEnvironmentEnsureResultSchema,
  DesktopSshEnvironmentTargetSchema,
  DesktopSshHttpBaseUrlInputSchema,
  DesktopSshPasswordPromptCancelledType,
  DesktopSshPasswordPromptResolutionInputSchema,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { fetchLoopbackSshJson } from "@t3tools/ssh/tunnel";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
  DISCONNECT_SSH_ENVIRONMENT_CHANNEL,
  DISCOVER_SSH_HOSTS_CHANNEL,
  ENSURE_SSH_ENVIRONMENT_CHANNEL,
  FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
  FETCH_SSH_SESSION_STATE_CHANNEL,
  ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
  RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
} from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";
import {
  DesktopSshEnvironmentBridge,
  DesktopSshEnvironmentManager,
  isSshPasswordPromptCancellation,
} from "../../sshEnvironment.ts";

const decodeExecutionEnvironmentDescriptor = Schema.decodeUnknownEffect(
  ExecutionEnvironmentDescriptor,
);
const decodeAuthBearerBootstrapResult = Schema.decodeUnknownEffect(AuthBearerBootstrapResult);
const decodeAuthSessionState = Schema.decodeUnknownEffect(AuthSessionState);
const decodeAuthWebSocketTokenResult = Schema.decodeUnknownEffect(AuthWebSocketTokenResult);

export const discoverSshHosts = makeIpcMethod({
  channel: DISCOVER_SSH_HOSTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopDiscoveredSshHostSchema),
  handler: () =>
    Effect.gen(function* () {
      const manager = yield* DesktopSshEnvironmentManager;
      return yield* manager.discoverHosts();
    }),
});

export const ensureSshEnvironment = makeIpcMethod({
  channel: ENSURE_SSH_ENVIRONMENT_CHANNEL,
  payload: DesktopSshEnvironmentEnsureInputSchema,
  result: DesktopSshEnvironmentEnsureResultSchema,
  handler: ({ target, options }) =>
    Effect.gen(function* () {
      const manager = yield* DesktopSshEnvironmentManager;
      return yield* manager.ensureEnvironment(target, options).pipe(
        Effect.catch((error) =>
          isSshPasswordPromptCancellation(error)
            ? Effect.succeed({
                type: DesktopSshPasswordPromptCancelledType,
                message: error.message,
              })
            : Effect.fail(error),
        ),
      );
    }),
});

export const disconnectSshEnvironment = makeIpcMethod({
  channel: DISCONNECT_SSH_ENVIRONMENT_CHANNEL,
  payload: DesktopSshEnvironmentTargetSchema,
  result: Schema.Void,
  handler: (target) =>
    Effect.gen(function* () {
      const manager = yield* DesktopSshEnvironmentManager;
      yield* manager.disconnectEnvironment(target);
    }),
});

export const fetchSshEnvironmentDescriptor = makeIpcMethod({
  channel: FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
  payload: DesktopSshHttpBaseUrlInputSchema,
  result: ExecutionEnvironmentDescriptor,
  handler: ({ httpBaseUrl }) =>
    fetchLoopbackSshJson<unknown>({
      httpBaseUrl,
      pathname: "/.well-known/t3/environment",
    }).pipe(Effect.flatMap(decodeExecutionEnvironmentDescriptor)),
});

export const bootstrapSshBearerSession = makeIpcMethod({
  channel: BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
  payload: DesktopSshBearerBootstrapInputSchema,
  result: AuthBearerBootstrapResult,
  handler: ({ httpBaseUrl, credential }) =>
    fetchLoopbackSshJson<unknown>({
      httpBaseUrl,
      pathname: "/api/auth/bootstrap/bearer",
      method: "POST",
      body: { credential },
    }).pipe(Effect.flatMap(decodeAuthBearerBootstrapResult)),
});

export const fetchSshSessionState = makeIpcMethod({
  channel: FETCH_SSH_SESSION_STATE_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthSessionState,
  handler: ({ httpBaseUrl, bearerToken }) =>
    fetchLoopbackSshJson<unknown>({
      httpBaseUrl,
      pathname: "/api/auth/session",
      bearerToken,
    }).pipe(Effect.flatMap(decodeAuthSessionState)),
});

export const issueSshWebSocketToken = makeIpcMethod({
  channel: ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthWebSocketTokenResult,
  handler: ({ httpBaseUrl, bearerToken }) =>
    fetchLoopbackSshJson<unknown>({
      httpBaseUrl,
      pathname: "/api/auth/ws-token",
      method: "POST",
      bearerToken,
    }).pipe(Effect.flatMap(decodeAuthWebSocketTokenResult)),
});

export const resolveSshPasswordPrompt = makeIpcMethod({
  channel: RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
  payload: DesktopSshPasswordPromptResolutionInputSchema,
  result: Schema.Void,
  handler: ({ requestId, password }) =>
    Effect.gen(function* () {
      const bridge = yield* DesktopSshEnvironmentBridge;
      yield* bridge.resolvePasswordPrompt(requestId, password);
    }),
});
