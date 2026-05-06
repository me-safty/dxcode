import {
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
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "@t3tools/contracts";
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
import * as DesktopSshEnvironment from "../../main/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "../../main/DesktopSshPasswordPrompts.ts";
import * as DesktopSshRemoteApi from "../../main/DesktopSshRemoteApi.ts";

export const discoverSshHosts = makeIpcMethod({
  channel: DISCOVER_SSH_HOSTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopDiscoveredSshHostSchema),
  handler: () =>
    Effect.gen(function* () {
      const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      return yield* sshEnvironment.discoverHosts();
    }),
});

export const ensureSshEnvironment = makeIpcMethod({
  channel: ENSURE_SSH_ENVIRONMENT_CHANNEL,
  payload: DesktopSshEnvironmentEnsureInputSchema,
  result: DesktopSshEnvironmentEnsureResultSchema,
  handler: ({ target, options }) =>
    Effect.gen(function* () {
      const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      return yield* sshEnvironment.ensureEnvironment(target, options).pipe(
        Effect.catch((error) =>
          DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(error)
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
      const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      yield* sshEnvironment.disconnectEnvironment(target);
    }),
});

export const fetchSshEnvironmentDescriptor = makeIpcMethod({
  channel: FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
  payload: DesktopSshHttpBaseUrlInputSchema,
  result: ExecutionEnvironmentDescriptor,
  handler: ({ httpBaseUrl }) =>
    Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      return yield* remoteApi.fetchEnvironmentDescriptor({ httpBaseUrl });
    }),
});

export const bootstrapSshBearerSession = makeIpcMethod({
  channel: BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
  payload: DesktopSshBearerBootstrapInputSchema,
  result: AuthBearerBootstrapResult,
  handler: ({ httpBaseUrl, credential }) =>
    Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      return yield* remoteApi.bootstrapBearerSession({ httpBaseUrl, credential });
    }),
});

export const fetchSshSessionState = makeIpcMethod({
  channel: FETCH_SSH_SESSION_STATE_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthSessionState,
  handler: ({ httpBaseUrl, bearerToken }) =>
    Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      return yield* remoteApi.fetchSessionState({ httpBaseUrl, bearerToken });
    }),
});

export const issueSshWebSocketToken = makeIpcMethod({
  channel: ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthWebSocketTokenResult,
  handler: ({ httpBaseUrl, bearerToken }) =>
    Effect.gen(function* () {
      const remoteApi = yield* DesktopSshRemoteApi.DesktopSshRemoteApi;
      return yield* remoteApi.issueWebSocketToken({ httpBaseUrl, bearerToken });
    }),
});

export const resolveSshPasswordPrompt = makeIpcMethod({
  channel: RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
  payload: DesktopSshPasswordPromptResolutionInputSchema,
  result: Schema.Void,
  handler: ({ requestId, password }) =>
    Effect.gen(function* () {
      const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
      yield* prompts.resolve({ requestId, password });
    }),
});
