import { Effect, FileSystem, Layer, Option, PubSub, Semaphore, Stream } from "effect";
import { ServerConfig } from "../../config.ts";
import { JiraTokenError } from "../Errors.ts";
import {
  JiraTokenService,
  type JiraTokenServiceShape,
  type JiraTokenSet,
} from "../Services/JiraTokenService.ts";
import { decryptTokens, deriveKey, encryptTokens } from "../crypto.ts";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const JiraTokenServiceLive = Layer.effect(
  JiraTokenService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const semaphore = yield* Semaphore.make(1);
    const pubSub = yield* PubSub.unbounded<Option.Option<JiraTokenSet>>();

    let cachedTokens: JiraTokenSet | null = null;
    let encryptionKey: Buffer | null = null;

    const getEncryptionKey = Effect.gen(function* () {
      if (encryptionKey) return encryptionKey;
      const seedExists = yield* fs.exists(config.anonymousIdPath);
      const seed = seedExists
        ? yield* fs.readFileString(config.anonymousIdPath)
        : "marcode-default-seed";
      encryptionKey = deriveKey(seed.trim());
      return encryptionKey;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new JiraTokenError({
            operation: "deriveEncryptionKey",
            detail: "Failed to derive encryption key",
            cause,
          }),
      ),
    );

    const loadTokensFromDisk = Effect.gen(function* () {
      const exists = yield* fs.exists(config.jiraTokensPath);
      if (!exists) return null;
      const key = yield* getEncryptionKey;
      const raw = yield* fs.readFileString(config.jiraTokensPath);
      const decrypted = decryptTokens(raw.trim(), key);
      return JSON.parse(decrypted) as JiraTokenSet;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new JiraTokenError({
            operation: "loadTokens",
            detail: "Failed to load Jira tokens from disk",
            cause,
          }),
      ),
    );

    const persistTokensToDisk = (tokens: JiraTokenSet) =>
      Effect.gen(function* () {
        const key = yield* getEncryptionKey;
        const encrypted = encryptTokens(JSON.stringify(tokens), key);
        yield* fs.writeFileString(config.jiraTokensPath, encrypted);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new JiraTokenError({
              operation: "persistTokens",
              detail: "Failed to persist Jira tokens",
              cause,
            }),
        ),
      );

    const refreshAccessToken = (tokens: JiraTokenSet) =>
      Effect.gen(function* () {
        if (!config.jiraTokenProxyUrl) {
          return yield* new JiraTokenError({
            operation: "refreshToken",
            detail: "MARCODE_JIRA_TOKEN_PROXY_URL is not configured",
          });
        }

        const clientId = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${config.jiraTokenProxyUrl}/api/jira/config`);
            if (!response.ok) return null;
            const data = (await response.json()) as { clientId?: string };
            return data.clientId ?? null;
          },
          catch: () =>
            new JiraTokenError({
              operation: "refreshToken",
              detail: "Failed to fetch Jira client ID from token proxy",
            }),
        });

        if (!clientId) {
          return yield* new JiraTokenError({
            operation: "refreshToken",
            detail: "Failed to resolve Jira client ID",
          });
        }

        const refreshTokenUrl = `${config.jiraTokenProxyUrl}/api/jira/token-exchange`;
        const refreshBody: Record<string, string> = {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refreshToken,
        };

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(refreshTokenUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(refreshBody),
            }),
          catch: (cause) =>
            new JiraTokenError({
              operation: "refreshToken",
              detail: "Failed to refresh Jira access token",
              cause,
            }),
        });

        if (!response.ok) {
          const body = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () =>
              new JiraTokenError({
                operation: "refreshToken",
                detail: `Token refresh failed with status ${response.status}`,
              }),
          });
          return yield* new JiraTokenError({
            operation: "refreshToken",
            detail: `Token refresh failed (${response.status}): ${body}`,
          });
        }

        const json = yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              access_token: string;
              refresh_token: string;
              expires_in: number;
              scope: string;
            }>,
          catch: (cause) =>
            new JiraTokenError({
              operation: "refreshToken",
              detail: "Failed to parse token refresh response",
              cause,
            }),
        });

        const refreshedTokens: JiraTokenSet = {
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt: Date.now() + json.expires_in * 1000,
          scope: json.scope,
        };

        cachedTokens = refreshedTokens;
        yield* persistTokensToDisk(refreshedTokens);
        yield* PubSub.publish(pubSub, Option.some(refreshedTokens));
        return refreshedTokens;
      });

    const getTokens: JiraTokenServiceShape["getTokens"] = semaphore.withPermits(1)(
      Effect.gen(function* () {
        if (cachedTokens) return Option.some(cachedTokens);
        const loaded = yield* loadTokensFromDisk;
        if (loaded) {
          cachedTokens = loaded;
          return Option.some(loaded);
        }
        return Option.none();
      }),
    );

    const saveTokens: JiraTokenServiceShape["saveTokens"] = (tokens: JiraTokenSet) =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          cachedTokens = tokens;
          yield* persistTokensToDisk(tokens);
          yield* PubSub.publish(pubSub, Option.some(tokens));
        }),
      );

    const clearTokens: JiraTokenServiceShape["clearTokens"] = semaphore.withPermits(1)(
      Effect.gen(function* () {
        cachedTokens = null;
        const exists = yield* fs.exists(config.jiraTokensPath);
        if (exists) {
          yield* fs.remove(config.jiraTokensPath);
        }
        yield* PubSub.publish(pubSub, Option.none());
      }).pipe(
        Effect.mapError(
          (cause) =>
            new JiraTokenError({
              operation: "clearTokens",
              detail: "Failed to clear Jira tokens",
              cause,
            }),
        ),
      ),
    );

    const getValidAccessToken: JiraTokenServiceShape["getValidAccessToken"] = semaphore.withPermits(
      1,
    )(
      Effect.gen(function* () {
        if (!cachedTokens) {
          const loaded = yield* loadTokensFromDisk;
          if (!loaded) {
            return yield* new JiraTokenError({
              operation: "getValidAccessToken",
              detail: "No Jira tokens available. Please connect your Jira account.",
            });
          }
          cachedTokens = loaded;
        }

        if (cachedTokens.expiresAt - Date.now() < REFRESH_BUFFER_MS) {
          const refreshed = yield* refreshAccessToken(cachedTokens);
          return refreshed.accessToken;
        }

        return cachedTokens.accessToken;
      }),
    );

    const streamChanges: JiraTokenServiceShape["streamChanges"] = Stream.fromPubSub(pubSub);

    return { getTokens, saveTokens, clearTokens, getValidAccessToken, streamChanges };
  }),
);
