import {
  AuthAccessTokenType,
  AuthAccessWriteScope,
  AuthAdministrativeScopes,
  AuthStandardClientScopes,
  type AuthAccessTokenResult,
  type AuthBrowserSessionResult,
  type AuthClientMetadata,
  type AuthClientSession,
  type AuthCreatePairingCredentialInput,
  type AuthEnvironmentScope,
  type AuthPairingLink,
  type AuthPairingCredentialResult,
  type AuthSessionId,
  type AuthSessionState,
  type ServerAuthDescriptor,
  type ServerAuthSessionMethod,
  type AuthWebSocketTicketResult,
} from "@t3tools/contracts";
import { encodeOAuthScope } from "@t3tools/shared/oauthScope";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";
import * as PairingGrantStore from "./PairingGrantStore.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import { verifyRequestDpopProof } from "./dpop.ts";
import { layerConfig as SqlitePersistenceLayer } from "../persistence/Layers/Sqlite.ts";

export const DEFAULT_SESSION_SUBJECT = "cli-issued-session";
export const INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT = "administrative-bootstrap";

export interface IssuedPairingLink {
  readonly id: string;
  readonly credential: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
}

export interface IssuedBearerSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: "bearer-access-token";
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly subject: string;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.Utc;
}

export interface AuthenticatedSession {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly proofKeyThumbprint?: string;
  readonly expiresAt?: DateTime.DateTime;
}

const ServerAuthInternalOperation = Schema.Literals([
  "validate_bootstrap_credential",
  "validate_session_credential",
  "issue_authenticated_session",
  "issue_authenticated_access_token",
  "create_pairing_link",
  "list_pairing_links",
  "revoke_pairing_link",
  "issue_session_token",
  "list_sessions",
  "revoke_session",
  "revoke_other_sessions",
  "issue_websocket_token",
  "record_dpop_replay_state",
  "calculate_dpop_replay_key",
  "verify_linked_cloud_account",
  "read_linked_cloud_account",
  "sign_cloud_link_jwt",
  "sign_cloud_health_jwt",
  "sign_cloud_mint_jwt",
]);
type ServerAuthInternalOperation = typeof ServerAuthInternalOperation.Type;

export class ServerAuthOperationError extends Schema.TaggedErrorClass<ServerAuthOperationError>()(
  "ServerAuthOperationError",
  {
    operation: ServerAuthInternalOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Server authentication operation '${this.operation}' failed.`;
  }
}

export class ServerAuthLinkedCloudAccountMissingError extends Schema.TaggedErrorClass<ServerAuthLinkedCloudAccountMissingError>()(
  "ServerAuthLinkedCloudAccountMissingError",
  {},
) {
  override get message(): string {
    return "Cloud linked user is not installed for this environment.";
  }
}

export class ServerAuthCloudMintPublicKeyMissingError extends Schema.TaggedErrorClass<ServerAuthCloudMintPublicKeyMissingError>()(
  "ServerAuthCloudMintPublicKeyMissingError",
  {},
) {
  override get message(): string {
    return "Cloud mint public key is not installed for this environment.";
  }
}

export class ServerAuthCloudRelayIssuerMissingError extends Schema.TaggedErrorClass<ServerAuthCloudRelayIssuerMissingError>()(
  "ServerAuthCloudRelayIssuerMissingError",
  {},
) {
  override get message(): string {
    return "Cloud relay issuer is not installed for this environment.";
  }
}

export const ServerAuthInternalError = Schema.Union([
  ServerAuthOperationError,
  ServerAuthLinkedCloudAccountMissingError,
  ServerAuthCloudMintPublicKeyMissingError,
  ServerAuthCloudRelayIssuerMissingError,
]);
export type ServerAuthInternalError = typeof ServerAuthInternalError.Type;
export const isServerAuthInternalError = Schema.is(ServerAuthInternalError);

export class ServerAuthMissingCredentialError extends Schema.TaggedErrorClass<ServerAuthMissingCredentialError>()(
  "ServerAuthMissingCredentialError",
  {},
) {
  override get message(): string {
    return "Server authentication credential is missing.";
  }
}

export class ServerAuthInvalidCredentialError extends Schema.TaggedErrorClass<ServerAuthInvalidCredentialError>()(
  "ServerAuthInvalidCredentialError",
  {
    diagnostic: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Server authentication credential is invalid.";
  }
}

export const ServerAuthCredentialError = Schema.Union([
  ServerAuthMissingCredentialError,
  ServerAuthInvalidCredentialError,
]);
export type ServerAuthCredentialError = typeof ServerAuthCredentialError.Type;
export const isServerAuthCredentialError = Schema.is(ServerAuthCredentialError);
export const serverAuthCredentialReason = (
  error: ServerAuthCredentialError,
): "missing_credential" | "invalid_credential" =>
  error._tag === "ServerAuthMissingCredentialError" ? "missing_credential" : "invalid_credential";

export class ServerAuthInvalidScopeError extends Schema.TaggedErrorClass<ServerAuthInvalidScopeError>()(
  "ServerAuthInvalidScopeError",
  {},
) {
  override get message(): string {
    return "The requested authentication scope is invalid.";
  }
}

export class ServerAuthScopeNotGrantedError extends Schema.TaggedErrorClass<ServerAuthScopeNotGrantedError>()(
  "ServerAuthScopeNotGrantedError",
  {},
) {
  override get message(): string {
    return "The requested authentication scope was not granted.";
  }
}

export const ServerAuthInvalidRequestError = Schema.Union([
  ServerAuthInvalidScopeError,
  ServerAuthScopeNotGrantedError,
]);
export type ServerAuthInvalidRequestError = typeof ServerAuthInvalidRequestError.Type;
export const isServerAuthInvalidRequestError = Schema.is(ServerAuthInvalidRequestError);
export const serverAuthInvalidRequestReason = (
  error: ServerAuthInvalidRequestError,
): "invalid_scope" | "scope_not_granted" =>
  error._tag === "ServerAuthInvalidScopeError" ? "invalid_scope" : "scope_not_granted";

export class ServerAuthForbiddenOperationError extends Schema.TaggedErrorClass<ServerAuthForbiddenOperationError>()(
  "ServerAuthForbiddenOperationError",
  {},
) {
  override get message(): string {
    return "The current authentication session cannot revoke itself.";
  }
}

export class EnvironmentAuth extends Context.Service<
  EnvironmentAuth,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
    readonly getSessionState: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthSessionState, ServerAuthInternalError>;
    readonly createBrowserSession: (
      credential: string,
      requestMetadata: AuthClientMetadata,
    ) => Effect.Effect<
      {
        readonly response: AuthBrowserSessionResult;
        readonly sessionToken: string;
      },
      ServerAuthInvalidCredentialError | ServerAuthInternalError
    >;
    readonly exchangeBootstrapCredentialForAccessToken: (
      credential: string,
      requestedScopes: ReadonlyArray<AuthEnvironmentScope> | undefined,
      requestMetadata: AuthClientMetadata,
      input?: {
        readonly proofKeyThumbprint?: string;
      },
    ) => Effect.Effect<
      AuthAccessTokenResult,
      ServerAuthInvalidCredentialError | ServerAuthInvalidRequestError | ServerAuthInternalError
    >;
    readonly createPairingLink: (input?: {
      readonly ttl?: Duration.Duration;
      readonly label?: string;
      readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
      readonly subject?: string;
      readonly proofKeyThumbprint?: string;
    }) => Effect.Effect<IssuedPairingLink, ServerAuthInternalError>;
    readonly issuePairingCredential: (
      input?: AuthCreatePairingCredentialInput,
    ) => Effect.Effect<AuthPairingCredentialResult, ServerAuthInternalError>;
    readonly issueStartupPairingCredential: () => Effect.Effect<
      AuthPairingCredentialResult,
      ServerAuthInternalError
    >;
    readonly listPairingLinks: (input?: {
      readonly excludeSubjects?: ReadonlyArray<string>;
    }) => Effect.Effect<ReadonlyArray<AuthPairingLink>, ServerAuthInternalError>;
    readonly revokePairingLink: (id: string) => Effect.Effect<boolean, ServerAuthInternalError>;
    readonly issueSession: (input?: {
      readonly ttl?: Duration.Duration;
      readonly subject?: string;
      readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
      readonly label?: string;
    }) => Effect.Effect<IssuedBearerSession, ServerAuthInternalError>;
    readonly listSessions: () => Effect.Effect<
      ReadonlyArray<AuthClientSession>,
      ServerAuthInternalError
    >;
    readonly revokeSession: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<boolean, ServerAuthInternalError>;
    readonly revokeOtherSessionsExcept: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<number, ServerAuthInternalError>;
    readonly listClientSessions: (
      currentSessionId: AuthSessionId,
    ) => Effect.Effect<ReadonlyArray<AuthClientSession>, ServerAuthInternalError>;
    readonly revokeClientSession: (
      currentSessionId: AuthSessionId,
      targetSessionId: AuthSessionId,
    ) => Effect.Effect<boolean, ServerAuthForbiddenOperationError | ServerAuthInternalError>;
    readonly revokeOtherClientSessions: (
      currentSessionId: AuthSessionId,
    ) => Effect.Effect<number, ServerAuthInternalError>;
    readonly authenticateHttpRequest: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly authenticateWebSocketUpgrade: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly issueWebSocketTicket: (
      session: Pick<AuthenticatedSession, "sessionId">,
    ) => Effect.Effect<AuthWebSocketTicketResult, ServerAuthInternalError>;
    readonly issueStartupPairingUrl: (
      baseUrl: string,
    ) => Effect.Effect<string, ServerAuthInternalError>;
  }
>()("t3/auth/EnvironmentAuth") {}

type BootstrapExchangeResult = {
  readonly response: AuthBrowserSessionResult;
  readonly sessionToken: string;
};

const AUTHORIZATION_PREFIX = "Bearer ";
const DPOP_AUTHORIZATION_PREFIX = "DPoP ";
const WEBSOCKET_TICKET_QUERY_PARAM = "wsTicket";

const bySessionPriority = (left: AuthClientSession, right: AuthClientSession) => {
  const leftCanManage = left.scopes.includes(AuthAccessWriteScope);
  const rightCanManage = right.scopes.includes(AuthAccessWriteScope);
  if (leftCanManage !== rightCanManage) {
    return leftCanManage ? -1 : 1;
  }
  if (left.connected !== right.connected) {
    return left.connected ? -1 : 1;
  }
  return right.issuedAt.epochMilliseconds - left.issuedAt.epochMilliseconds;
};

const serverAuthInternalError = (
  operation: ServerAuthInternalOperation,
  cause: unknown,
): ServerAuthOperationError => new ServerAuthOperationError({ operation, cause });

const toInternalError =
  (operation: ServerAuthInternalOperation) =>
  (cause: unknown): ServerAuthInternalError =>
    serverAuthInternalError(operation, cause);

export function toBootstrapExchangeError(
  cause: PairingGrantStore.BootstrapCredentialError,
): ServerAuthInvalidCredentialError | ServerAuthInternalError {
  if (PairingGrantStore.isBootstrapCredentialInternalError(cause)) {
    return serverAuthInternalError("validate_bootstrap_credential", cause);
  }

  return new ServerAuthInvalidCredentialError({
    cause,
  });
}

const mapSessionVerificationErrors = <A, R>(
  effect: Effect.Effect<A, SessionStore.SessionCredentialError, R>,
): Effect.Effect<A, ServerAuthInvalidCredentialError | ServerAuthInternalError, R> =>
  effect.pipe(
    Effect.mapError((cause) =>
      SessionStore.isSessionCredentialInvalidError(cause)
        ? new ServerAuthInvalidCredentialError({ cause })
        : serverAuthInternalError("validate_session_credential", cause),
    ),
  );

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function parseDpopToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(DPOP_AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(DPOP_AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export const make = Effect.gen(function* () {
  const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
  const bootstrapCredentials = yield* PairingGrantStore.PairingGrantStore;
  const sessions = yield* SessionStore.SessionStore;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const descriptor = yield* policy.getDescriptor();

  const authenticateToken = (
    token: string,
  ): Effect.Effect<
    AuthenticatedSession,
    ServerAuthInvalidCredentialError | ServerAuthInternalError
  > =>
    sessions.verify(token).pipe(
      Effect.tapError((cause) =>
        SessionStore.isSessionCredentialInvalidError(cause)
          ? Effect.logWarning("Rejected authenticated session credential.").pipe(
              Effect.annotateLogs({
                reason: cause.message,
              }),
            )
          : Effect.void,
      ),
      Effect.map((session) => ({
        sessionId: session.sessionId,
        subject: session.subject,
        method: session.method,
        scopes: session.scopes,
        ...(session.proofKeyThumbprint ? { proofKeyThumbprint: session.proofKeyThumbprint } : {}),
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
      })),
      mapSessionVerificationErrors,
    );

  const authenticateRequest = (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError> => {
    const cookieToken = request.cookies[sessions.cookieName];
    const bearerToken = parseBearerToken(request);
    const dpopToken = parseDpopToken(request);
    const credential = cookieToken ?? bearerToken ?? dpopToken;
    if (!credential) {
      return Effect.fail(new ServerAuthMissingCredentialError({}));
    }
    return authenticateToken(credential).pipe(
      Effect.flatMap((session) => {
        if (session.proofKeyThumbprint) {
          if (!dpopToken || dpopToken !== credential) {
            return Effect.fail(
              new ServerAuthInvalidCredentialError({
                diagnostic: "DPoP-bound access token requires DPoP authorization.",
              }),
            );
          }
          return verifyRequestDpopProof({
            request,
            expectedThumbprint: session.proofKeyThumbprint,
            expectedAccessToken: dpopToken,
          }).pipe(
            Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.as(session),
          );
        }
        if (dpopToken) {
          return Effect.fail(
            new ServerAuthInvalidCredentialError({
              diagnostic: "DPoP authorization requires a proof-bound access token.",
            }),
          );
        }
        return Effect.succeed(session);
      }),
    );
  };

  const getSessionState: EnvironmentAuth["Service"]["getSessionState"] = (request) =>
    authenticateRequest(request).pipe(
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            auth: descriptor,
            scopes: session.scopes,
            sessionMethod: session.method,
            ...(session.expiresAt ? { expiresAt: DateTime.toUtc(session.expiresAt) } : {}),
          }) satisfies AuthSessionState,
      ),
      Effect.catchIf(isServerAuthCredentialError, () =>
        Effect.succeed({
          authenticated: false,
          auth: descriptor,
        } satisfies AuthSessionState),
      ),
      Effect.withSpan("EnvironmentAuth.getSessionState"),
    );

  const createBrowserSession: EnvironmentAuth["Service"]["createBrowserSession"] = (
    credential,
    requestMetadata,
  ) =>
    bootstrapCredentials.consume(credential).pipe(
      Effect.mapError(toBootstrapExchangeError),
      Effect.flatMap((grant) =>
        sessions
          .issue({
            method: "browser-session-cookie",
            subject: grant.subject,
            scopes: grant.scopes,
            client: {
              ...requestMetadata,
              ...(grant.label ? { label: grant.label } : {}),
            },
          })
          .pipe(
            Effect.mapError((cause) =>
              serverAuthInternalError("issue_authenticated_session", cause),
            ),
          ),
      ),
      Effect.map(
        (session) =>
          ({
            response: {
              authenticated: true,
              scopes: session.scopes,
              sessionMethod: session.method,
              expiresAt: DateTime.toUtc(session.expiresAt),
            } satisfies AuthBrowserSessionResult,
            sessionToken: session.token,
          }) satisfies BootstrapExchangeResult,
      ),
      Effect.withSpan("EnvironmentAuth.createBrowserSession"),
    );

  const exchangeBootstrapCredentialForAccessToken: EnvironmentAuth["Service"]["exchangeBootstrapCredentialForAccessToken"] =
    (credential, requestedScopes, requestMetadata, input) =>
      bootstrapCredentials.consume(credential, input).pipe(
        Effect.mapError(toBootstrapExchangeError),
        Effect.flatMap((grant) =>
          Effect.gen(function* () {
            const grantedScopes = requestedScopes ?? grant.scopes;
            if (!grantedScopes.every((scope) => grant.scopes.includes(scope))) {
              return yield* new ServerAuthScopeNotGrantedError({});
            }
            return yield* sessions
              .issue({
                method: input?.proofKeyThumbprint ? "dpop-access-token" : "bearer-access-token",
                subject: grant.subject,
                scopes: grantedScopes,
                ...(input?.proofKeyThumbprint
                  ? {
                      proofKeyThumbprint: input.proofKeyThumbprint,
                      ttl: Duration.hours(1),
                    }
                  : {}),
                client: {
                  ...requestMetadata,
                  ...(grant.label ? { label: grant.label } : {}),
                },
              })
              .pipe(
                Effect.mapError((cause) =>
                  serverAuthInternalError("issue_authenticated_access_token", cause),
                ),
              );
          }),
        ),
        Effect.flatMap((session) =>
          DateTime.now.pipe(
            Effect.map(
              (now) =>
                ({
                  access_token: session.token,
                  issued_token_type: AuthAccessTokenType,
                  token_type: input?.proofKeyThumbprint ? "DPoP" : "Bearer",
                  expires_in: Math.max(
                    0,
                    Math.floor(
                      (session.expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000,
                    ),
                  ),
                  scope: encodeOAuthScope(session.scopes),
                }) satisfies AuthAccessTokenResult,
            ),
          ),
        ),
        Effect.withSpan("EnvironmentAuth.exchangeBootstrapCredentialForAccessToken"),
      );

  const issuePairingCredentialForSubject = (input: {
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    readonly subject: string;
    readonly label?: string;
  }) =>
    createPairingLink({
      scopes: input.scopes,
      subject: input.subject,
      ...(input.label ? { label: input.label } : {}),
    }).pipe(
      Effect.map(
        (issued) =>
          ({
            id: issued.id,
            credential: issued.credential,
            ...(issued.label ? { label: issued.label } : {}),
            expiresAt: issued.expiresAt,
          }) satisfies AuthPairingCredentialResult,
      ),
    );

  const createPairingLink: EnvironmentAuth["Service"]["createPairingLink"] = Effect.fn(
    "EnvironmentAuth.createPairingLink",
  )(
    function* (input) {
      const createdAt = yield* DateTime.now;
      const issued = yield* bootstrapCredentials.issueOneTimeToken({
        scopes: input?.scopes ?? AuthStandardClientScopes,
        subject: input?.subject ?? "one-time-token",
        ...(input?.ttl ? { ttl: input.ttl } : {}),
        ...(input?.label ? { label: input.label } : {}),
        ...(input?.proofKeyThumbprint ? { proofKeyThumbprint: input.proofKeyThumbprint } : {}),
      });
      return {
        id: issued.id,
        credential: issued.credential,
        scopes: input?.scopes ?? AuthStandardClientScopes,
        subject: input?.subject ?? "one-time-token",
        ...(issued.label ? { label: issued.label } : {}),
        createdAt: DateTime.toUtc(createdAt),
        expiresAt: DateTime.toUtc(issued.expiresAt),
      } satisfies IssuedPairingLink;
    },
    Effect.mapError(toInternalError("create_pairing_link")),
  );

  const listPairingLinks: EnvironmentAuth["Service"]["listPairingLinks"] = (input) =>
    bootstrapCredentials.listActive().pipe(
      Effect.map((pairingLinks) => {
        const excludedSubjects = input?.excludeSubjects ?? [
          INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT,
        ];
        return pairingLinks
          .filter((pairingLink) => !excludedSubjects.includes(pairingLink.subject))
          .toSorted(
            (left, right) => right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds,
          );
      }),
      Effect.mapError(toInternalError("list_pairing_links")),
      Effect.withSpan("EnvironmentAuth.listPairingLinks"),
    );

  const revokePairingLink: EnvironmentAuth["Service"]["revokePairingLink"] = (id) =>
    bootstrapCredentials
      .revoke(id)
      .pipe(
        Effect.mapError(toInternalError("revoke_pairing_link")),
        Effect.withSpan("EnvironmentAuth.revokePairingLink"),
      );

  const issueSession: EnvironmentAuth["Service"]["issueSession"] = (input) =>
    sessions
      .issue({
        subject: input?.subject ?? DEFAULT_SESSION_SUBJECT,
        method: "bearer-access-token",
        scopes: input?.scopes ?? AuthAdministrativeScopes,
        client: {
          ...(input?.label ? { label: input.label } : {}),
          deviceType: "bot",
        },
        ...(input?.ttl ? { ttl: input.ttl } : {}),
      })
      .pipe(
        Effect.map(
          (issued) =>
            ({
              sessionId: issued.sessionId,
              token: issued.token,
              method: "bearer-access-token",
              scopes: issued.scopes,
              subject: input?.subject ?? DEFAULT_SESSION_SUBJECT,
              client: issued.client,
              expiresAt: DateTime.toUtc(issued.expiresAt),
            }) satisfies IssuedBearerSession,
        ),
        Effect.mapError(toInternalError("issue_session_token")),
        Effect.withSpan("EnvironmentAuth.issueSession"),
      );

  const listSessions: EnvironmentAuth["Service"]["listSessions"] = () =>
    sessions.listActive().pipe(
      Effect.map((activeSessions) => activeSessions.toSorted(bySessionPriority)),
      Effect.mapError(toInternalError("list_sessions")),
      Effect.withSpan("EnvironmentAuth.listSessions"),
    );

  const revokeSession: EnvironmentAuth["Service"]["revokeSession"] = (sessionId) =>
    sessions
      .revoke(sessionId)
      .pipe(
        Effect.mapError(toInternalError("revoke_session")),
        Effect.withSpan("EnvironmentAuth.revokeSession"),
      );

  const revokeOtherSessionsExcept: EnvironmentAuth["Service"]["revokeOtherSessionsExcept"] = (
    sessionId,
  ) =>
    sessions
      .revokeAllExcept(sessionId)
      .pipe(
        Effect.mapError(toInternalError("revoke_other_sessions")),
        Effect.withSpan("EnvironmentAuth.revokeOtherSessionsExcept"),
      );

  const issuePairingCredential: EnvironmentAuth["Service"]["issuePairingCredential"] = (input) =>
    issuePairingCredentialForSubject({
      scopes: input?.scopes ?? AuthStandardClientScopes,
      subject: "one-time-token",
      ...(input?.label ? { label: input.label } : {}),
    }).pipe(Effect.withSpan("EnvironmentAuth.issuePairingCredential"));

  const issueStartupPairingCredential: EnvironmentAuth["Service"]["issueStartupPairingCredential"] =
    () =>
      issuePairingCredentialForSubject({
        scopes: AuthAdministrativeScopes,
        subject: INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT,
      }).pipe(Effect.withSpan("EnvironmentAuth.issueStartupPairingCredential"));

  const listClientSessions: EnvironmentAuth["Service"]["listClientSessions"] = (currentSessionId) =>
    listSessions().pipe(
      Effect.map((clientSessions) =>
        clientSessions.map(
          (clientSession): AuthClientSession => ({
            ...clientSession,
            current: clientSession.sessionId === currentSessionId,
          }),
        ),
      ),
      Effect.withSpan("EnvironmentAuth.listClientSessions"),
    );

  const revokeClientSession: EnvironmentAuth["Service"]["revokeClientSession"] = Effect.fn(
    "EnvironmentAuth.revokeClientSession",
  )(function* (currentSessionId, targetSessionId) {
    if (currentSessionId === targetSessionId) {
      return yield* new ServerAuthForbiddenOperationError({});
    }
    return yield* revokeSession(targetSessionId);
  });

  const revokeOtherClientSessions: EnvironmentAuth["Service"]["revokeOtherClientSessions"] = (
    currentSessionId,
  ) =>
    revokeOtherSessionsExcept(currentSessionId).pipe(
      Effect.withSpan("EnvironmentAuth.revokeOtherClientSessions"),
    );

  const issueStartupPairingUrl: EnvironmentAuth["Service"]["issueStartupPairingUrl"] = (baseUrl) =>
    issueStartupPairingCredential().pipe(
      Effect.map((issued) => {
        const url = new URL(baseUrl);
        url.pathname = "/pair";
        url.searchParams.delete("token");
        url.hash = new URLSearchParams([["token", issued.credential]]).toString();
        return url.toString();
      }),
      Effect.withSpan("EnvironmentAuth.issueStartupPairingUrl"),
    );

  const issueWebSocketTicket: EnvironmentAuth["Service"]["issueWebSocketTicket"] = (session) =>
    sessions.issueWebSocketToken(session.sessionId).pipe(
      Effect.mapError((cause) => serverAuthInternalError("issue_websocket_token", cause)),
      Effect.map(
        (issued) =>
          ({
            ticket: issued.token,
            expiresAt: DateTime.toUtc(issued.expiresAt),
          }) satisfies AuthWebSocketTicketResult,
      ),
      Effect.withSpan("EnvironmentAuth.issueWebSocketTicket"),
    );

  const authenticateHttpRequest: EnvironmentAuth["Service"]["authenticateHttpRequest"] = (
    request,
  ) =>
    authenticateRequest(request).pipe(Effect.withSpan("EnvironmentAuth.authenticateHttpRequest"));

  const authenticateWebSocketUpgrade: EnvironmentAuth["Service"]["authenticateWebSocketUpgrade"] =
    Effect.fn("EnvironmentAuth.authenticateWebSocketUpgrade")(function* (request) {
      const requestUrl = HttpServerRequest.toURL(request);
      if (Option.isSome(requestUrl)) {
        const websocketTicket = requestUrl.value.searchParams.get(WEBSOCKET_TICKET_QUERY_PARAM);
        if (websocketTicket && websocketTicket.trim().length > 0) {
          return yield* sessions.verifyWebSocketToken(websocketTicket).pipe(
            Effect.map((session) => ({
              sessionId: session.sessionId,
              subject: session.subject,
              method: session.method,
              scopes: session.scopes,
              ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
            })),
            mapSessionVerificationErrors,
          );
        }
      }

      return yield* authenticateRequest(request);
    });

  return EnvironmentAuth.of({
    getDescriptor: () =>
      Effect.succeed(descriptor).pipe(Effect.withSpan("EnvironmentAuth.getDescriptor")),
    getSessionState,
    createBrowserSession,
    exchangeBootstrapCredentialForAccessToken,
    createPairingLink,
    issuePairingCredential,
    issueStartupPairingCredential,
    listPairingLinks,
    revokePairingLink,
    issueSession,
    listSessions,
    revokeSession,
    revokeOtherSessionsExcept,
    listClientSessions,
    revokeClientSession,
    revokeOtherClientSessions,
    authenticateHttpRequest,
    authenticateWebSocketUpgrade,
    issueWebSocketTicket,
    issueStartupPairingUrl,
  });
});

export const layer = Layer.effect(EnvironmentAuth, make).pipe(
  Layer.provideMerge(PairingGrantStore.layer),
  Layer.provideMerge(SessionStore.layer),
  Layer.provideMerge(EnvironmentAuthPolicy.layer),
);

export const storageLayer = Layer.mergeAll(ServerSecretStore.layer, SqlitePersistenceLayer);

export const runtimeLayer = layer.pipe(Layer.provideMerge(storageLayer));
