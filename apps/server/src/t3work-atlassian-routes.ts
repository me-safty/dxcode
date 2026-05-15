import {
  AtlassianIntegrationProvider,
  type AtlassianAccessibleResource,
  type JiraApiAuth,
  type TokenExchangeResult,
} from "@t3tools/integrations-atlassian";
import { MockIntegrationProvider } from "@t3tools/integrations-core/mock";
import type { IntegrationAccountRef } from "@t3tools/integrations-core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { ServerConfig } from "./config.ts";
import { browserApiCorsHeaders } from "./httpCors.ts";

type BasicConnectInput = {
  readonly auth: {
    readonly kind: "basic";
    readonly siteUrl: string;
    readonly email: string;
    readonly apiToken: string;
  };
};

type OAuthConnectInput = {
  readonly auth: {
    readonly kind: "oauth";
    readonly sites: ReadonlyArray<AtlassianAccessibleResource>;
    readonly token: TokenExchangeResult;
  };
};

type ResourceListInput = {
  readonly account: IntegrationAccountRef;
  readonly externalProjectId: string;
  readonly limit?: number;
};

type ResourceGetInput = {
  readonly accountId: string;
  readonly ref: unknown;
};

type PersistedAtlassianAuths = {
  readonly version: 1;
  readonly auths: ReadonlyArray<{
    readonly accountId: string;
    readonly auth: JiraApiAuth;
  }>;
};

const ATLASSIAN_AUTH_SECRET_NAME = "t3work-atlassian-auths";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PersistedJiraApiAuth = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    cloudId: Schema.String,
    accessToken: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("basic"),
    siteUrl: Schema.String,
    email: Schema.String,
    apiToken: Schema.String,
  }),
]);
const PersistedAtlassianAuths = Schema.Struct({
  version: Schema.Literal(1),
  auths: Schema.Array(
    Schema.Struct({
      accountId: Schema.String,
      auth: PersistedJiraApiAuth,
    }),
  ),
});
const PersistedAtlassianAuthsJson = fromJsonStringPretty(PersistedAtlassianAuths);
const decodePersistedAtlassianAuths = Schema.decodeEffect(PersistedAtlassianAuthsJson);
const encodePersistedAtlassianAuths = Schema.encodeEffect(PersistedAtlassianAuthsJson);

const mockProvider = new MockIntegrationProvider();
const atlassianAuths = new Map<string, JiraApiAuth>();

class T3workAtlassianError extends Data.TaggedError("T3workAtlassianError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function providerForAccount(accountId: string) {
  return Effect.gen(function* () {
    yield* loadPersistedAuths;
    const auth = atlassianAuths.get(accountId);
    return auth ? new AtlassianIntegrationProvider(auth) : mockProvider;
  });
}

function providerForPersistedAuths() {
  return Effect.gen(function* () {
    yield* loadPersistedAuths;
    const auths = [...atlassianAuths.values()];
    return auths.length > 0 ? AtlassianIntegrationProvider.fromMultipleAuths(auths) : null;
  });
}

function toAtlassianError(message: string) {
  return (cause: unknown) =>
    new T3workAtlassianError({
      message: cause instanceof Error ? cause.message : message,
      cause,
    });
}

function readJsonBody<T>() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return (yield* request.json.pipe(
      Effect.mapError(toAtlassianError("Invalid Atlassian request.")),
    )) as T;
  });
}

function tryAtlassianPromise<T>(thunk: () => Promise<T>, message: string) {
  return Effect.tryPromise({
    try: thunk,
    catch: toAtlassianError(message),
  });
}

function okJson(body: unknown) {
  return HttpServerResponse.jsonUnsafe(body, { status: 200, headers: browserApiCorsHeaders });
}

function errorResponse(error: T3workAtlassianError) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.message },
      { status: 502, headers: browserApiCorsHeaders },
    ),
  );
}

function persistedAuthsPayload(): PersistedAtlassianAuths {
  const payload: PersistedAtlassianAuths = {
    version: 1,
    auths: [...atlassianAuths].map(([accountId, auth]) => ({ accountId, auth })),
  };
  return payload;
}

const atlassianAuthSecretPath = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  yield* fileSystem
    .makeDirectory(serverConfig.secretsDir, { recursive: true })
    .pipe(Effect.mapError(toAtlassianError("Failed to prepare Atlassian settings directory.")));
  yield* fileSystem
    .chmod(serverConfig.secretsDir, 0o700)
    .pipe(Effect.mapError(toAtlassianError("Failed to secure Atlassian settings directory.")));
  return path.join(serverConfig.secretsDir, `${ATLASSIAN_AUTH_SECRET_NAME}.bin`);
});

const loadPersistedAuths = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const secretPath = yield* atlassianAuthSecretPath;
  const persisted = yield* fileSystem.readFile(secretPath).pipe(
    Effect.map((bytes) => Uint8Array.from(bytes)),
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed(null)
        : Effect.fail(toAtlassianError("Failed to load persisted Atlassian settings.")(cause)),
    ),
  );
  if (!persisted) return;

  const parsed = yield* decodePersistedAtlassianAuths(textDecoder.decode(persisted)).pipe(
    Effect.mapError(toAtlassianError("Failed to parse persisted Atlassian settings.")),
  );

  for (const entry of parsed.auths) {
    atlassianAuths.set(entry.accountId, entry.auth);
  }
});

const savePersistedAuths = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const secretPath = yield* atlassianAuthSecretPath;
  const encoded = yield* encodePersistedAtlassianAuths(persistedAuthsPayload()).pipe(
    Effect.mapError(toAtlassianError("Failed to encode Atlassian settings.")),
  );
  const tempPath = `${secretPath}.${globalThis.crypto.randomUUID()}.tmp`;
  yield* Effect.gen(function* () {
    yield* fileSystem.writeFile(tempPath, textEncoder.encode(encoded));
    yield* fileSystem.chmod(tempPath, 0o600);
    yield* fileSystem.rename(tempPath, secretPath);
    yield* fileSystem.chmod(secretPath, 0o600);
  }).pipe(
    Effect.catch((cause) =>
      fileSystem.remove(tempPath).pipe(
        Effect.ignore,
        Effect.flatMap(() =>
          Effect.fail(toAtlassianError("Failed to persist Atlassian settings.")(cause)),
        ),
      ),
    ),
  );
});

export const t3workAtlassianConnectBasicRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/connect/basic",
  Effect.gen(function* () {
    yield* loadPersistedAuths;
    const input = yield* readJsonBody<BasicConnectInput>();

    if (!input.auth.apiToken.trim()) {
      return okJson({
        accounts: yield* tryAtlassianPromise(
          () => mockProvider.listAccounts(),
          "Failed to load preview Atlassian accounts.",
        ),
      });
    }

    const provider = new AtlassianIntegrationProvider(input.auth);
    const accounts = yield* tryAtlassianPromise(
      () => provider.listAccounts(),
      "Failed to connect to Atlassian.",
    );
    for (const account of accounts) {
      atlassianAuths.set(account.id, input.auth);
    }
    yield* savePersistedAuths;
    return okJson({ accounts });
  }).pipe(Effect.catch(errorResponse)),
);

export const t3workAtlassianAccountsRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/accounts",
  Effect.gen(function* () {
    const provider = yield* providerForPersistedAuths();
    if (!provider) {
      return okJson({ accounts: [] });
    }
    const accounts = yield* tryAtlassianPromise(
      () => provider.listAccounts(),
      "Failed to load persisted Atlassian accounts.",
    );
    return okJson({ accounts });
  }).pipe(Effect.catch(errorResponse)),
);

export const t3workAtlassianConnectOAuthRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/connect/oauth",
  Effect.gen(function* () {
    yield* loadPersistedAuths;
    const input = yield* readJsonBody<OAuthConnectInput>();
    const auths: ReadonlyArray<JiraApiAuth> = input.auth.sites.map((site) => ({
      kind: "oauth",
      cloudId: site.id,
      accessToken: input.auth.token.accessToken,
    }));

    if (auths.length === 0) {
      return okJson({
        accounts: yield* tryAtlassianPromise(
          () => mockProvider.listAccounts(),
          "Failed to load preview Atlassian accounts.",
        ),
      });
    }

    const provider = AtlassianIntegrationProvider.fromMultipleAuths(auths);
    const accounts = yield* tryAtlassianPromise(
      () => provider.listAccounts(),
      "Failed to connect to Atlassian.",
    );
    for (const account of accounts) {
      const auth = auths.find(
        (candidate) => candidate.kind === "oauth" && candidate.cloudId === account.id,
      );
      if (auth) {
        atlassianAuths.set(account.id, auth);
      }
    }
    yield* savePersistedAuths;
    return okJson({ accounts });
  }).pipe(Effect.catch(errorResponse)),
);

export const t3workAtlassianProjectsRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/projects",
  Effect.gen(function* () {
    const account = yield* readJsonBody<IntegrationAccountRef>();
    const provider = yield* providerForAccount(account.id);
    const projects = yield* tryAtlassianPromise(
      () => provider.listProjects(account),
      "Failed to load Atlassian projects.",
    );
    return okJson({ projects });
  }).pipe(Effect.catch(errorResponse)),
);

export const t3workAtlassianResourcesRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/resources",
  Effect.gen(function* () {
    const input = yield* readJsonBody<ResourceListInput>();
    const provider = yield* providerForAccount(input.account.id);
    const page = yield* tryAtlassianPromise(
      () =>
        provider.listResources({
          account: input.account,
          externalProjectId: input.externalProjectId,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        }),
      "Failed to load Atlassian issues.",
    );
    return okJson({ page });
  }).pipe(Effect.catch(errorResponse)),
);

export const t3workAtlassianResourceRouteLayer = HttpRouter.add(
  "POST",
  "/api/t3work/atlassian/resource",
  Effect.gen(function* () {
    const input = yield* readJsonBody<ResourceGetInput>();
    const provider = yield* providerForAccount(input.accountId);
    const snapshot = yield* tryAtlassianPromise(
      () => provider.getResource(input.ref),
      "Failed to load Atlassian issue.",
    );
    return okJson({ snapshot });
  }).pipe(Effect.catch(errorResponse)),
);
