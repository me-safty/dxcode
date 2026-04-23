import * as crypto from "node:crypto";
import * as http from "node:http";
import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { JiraTokenService } from "./Services/JiraTokenService.ts";
import type { JiraTokenSet } from "./Services/JiraTokenService.ts";
import { JiraApiClient } from "./Services/JiraApiClient.ts";
import { JiraOAuthError, JiraTokenError, JiraApiError } from "./Errors.ts";

const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";

const OAUTH_SCOPES = "read:jira-work read:jira-user offline_access read:me";
const STATE_TTL_MS = 5 * 60 * 1000;
const OAUTH_CALLBACK_PORT = 19571;
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

interface PkceState {
  readonly codeVerifier: string;
  readonly createdAt: number;
}

const pendingStates = new Map<string, PkceState>();
let callbackServer: http.Server | null = null;
let callbackServerTimeout: ReturnType<typeof setTimeout> | null = null;

function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now - value.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function getRedirectUri(config: ServerConfigShape): string {
  if (config.jiraRedirectUri) {
    return config.jiraRedirectUri;
  }
  return `http://localhost:${OAUTH_CALLBACK_PORT}/api/jira/callback`;
}

function shutdownCallbackServer(): void {
  if (callbackServerTimeout) {
    clearTimeout(callbackServerTimeout);
    callbackServerTimeout = null;
  }
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

function startCallbackServer(config: ServerConfigShape): Promise<void> {
  shutdownCallbackServer();

  const mainServerHost = config.host ?? "127.0.0.1";

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);
      if (reqUrl.pathname !== "/api/jira/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const mainCallbackUrl = `http://${mainServerHost}:${config.port}/api/jira/callback${reqUrl.search}`;
      res.writeHead(302, { Location: mainCallbackUrl });
      res.end();
      shutdownCallbackServer();
    });

    server.once("error", (err: NodeJS.ErrnoException) => {
      callbackServer = null;
      if (err.code === "EADDRINUSE") {
        reject(new Error(`OAuth callback port ${OAUTH_CALLBACK_PORT} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(OAUTH_CALLBACK_PORT, "localhost", () => {
      callbackServer = server;
      callbackServerTimeout = setTimeout(() => {
        shutdownCallbackServer();
      }, OAUTH_CALLBACK_TIMEOUT_MS);
      resolve();
    });
  });
}

async function fetchJiraClientId(proxyUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${proxyUrl}/api/jira/config`);
    if (!response.ok) return null;
    const data = (await response.json()) as { clientId?: string };
    return data.clientId ?? null;
  } catch {
    return null;
  }
}

const RESULT_PAGE_STYLE =
  "body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa}.card{text-align:center;padding:3rem;border-radius:1rem;border:1px solid #262626;background:#111;max-width:480px}.icon{font-size:3rem;margin-bottom:1rem}h1{margin:0 0 .5rem;font-size:1.25rem}p{margin:0;color:#a1a1aa;font-size:.875rem}.detail{margin-top:1rem;padding:.75rem;border-radius:.5rem;background:#1a1a1a;color:#a1a1aa;font-size:.75rem;text-align:left;word-break:break-all;max-height:120px;overflow:auto}";

function resultPage(
  icon: string,
  title: string,
  subtitle: string,
  detail?: string,
): HttpServerResponse.HttpServerResponse {
  const detailHtml = detail
    ? `<div class="detail">${detail.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
    : "";
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>${RESULT_PAGE_STYLE}</style></head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${subtitle}</p>${detailHtml}</div></body></html>`;
  return HttpServerResponse.text(html, { contentType: "text/html; charset=utf-8" });
}

export const jiraAuthRouteLayer = HttpRouter.add(
  "GET",
  "/api/jira/auth",
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    if (!config.jiraTokenProxyUrl) {
      return HttpServerResponse.text("MARCODE_JIRA_TOKEN_PROXY_URL is not configured", {
        status: 500,
      });
    }

    cleanExpiredStates();

    const state = crypto.randomBytes(16).toString("hex");
    const { codeVerifier, codeChallenge } = generatePkce();

    pendingStates.set(state, { codeVerifier, createdAt: Date.now() });

    const redirectUri = getRedirectUri(config);
    const proxyUrl = config.jiraTokenProxyUrl;

    yield* Effect.tryPromise({
      try: () => startCallbackServer(config),
      catch: (err) =>
        new JiraOAuthError({
          operation: "startCallbackServer",
          detail:
            err instanceof Error
              ? err.message
              : `Failed to start OAuth callback server on port ${OAUTH_CALLBACK_PORT}`,
        }),
    });

    const clientId = yield* Effect.tryPromise({
      try: () => fetchJiraClientId(proxyUrl),
      catch: () =>
        new JiraOAuthError({
          operation: "fetchClientId",
          detail: "Failed to fetch Jira client ID from token proxy",
        }),
    });

    if (!clientId) {
      return HttpServerResponse.text("Failed to fetch Jira client ID from token proxy", {
        status: 500,
      });
    }

    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: clientId,
      scope: OAUTH_SCOPES,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return HttpServerResponse.redirect(`${ATLASSIAN_AUTHORIZE_URL}?${params.toString()}`);
  }).pipe(
    Effect.catch((error: JiraOAuthError) =>
      Effect.succeed(
        HttpServerResponse.text(`Jira OAuth error: ${error.message}`, { status: 500 }),
      ),
    ),
  ),
);

export const jiraCallbackRouteLayer = HttpRouter.add(
  "GET",
  "/api/jira/callback",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const tokenService = yield* JiraTokenService;

    const code = url.value.searchParams.get("code");
    const state = url.value.searchParams.get("state");
    const error = url.value.searchParams.get("error");

    if (error) {
      const description = url.value.searchParams.get("error_description") ?? error;
      return resultPage(
        "\u274C",
        "Jira connection failed",
        "Atlassian returned an error.",
        description,
      );
    }

    if (!code || !state) {
      return resultPage(
        "\u274C",
        "Jira connection failed",
        "Missing code or state parameter in callback.",
      );
    }

    const pkceState = pendingStates.get(state);
    pendingStates.delete(state);

    if (!pkceState || Date.now() - pkceState.createdAt > STATE_TTL_MS) {
      return resultPage(
        "\u274C",
        "Jira connection failed",
        "Session expired. Please try connecting again from MarCode.",
      );
    }

    if (!config.jiraTokenProxyUrl) {
      return resultPage(
        "\u274C",
        "Jira connection failed",
        "MARCODE_JIRA_TOKEN_PROXY_URL is not configured.",
      );
    }

    const clientId = yield* Effect.tryPromise({
      try: () => fetchJiraClientId(config.jiraTokenProxyUrl!),
      catch: () =>
        new JiraOAuthError({
          operation: "fetchClientId",
          detail: "Failed to fetch Jira client ID from token proxy",
        }),
    });

    if (!clientId) {
      return resultPage("\u274C", "Jira connection failed", "Failed to resolve Jira client ID.");
    }

    const tokenUrl = `${config.jiraTokenProxyUrl}/api/jira/token-exchange`;
    const tokenBody: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: getRedirectUri(config),
      code_verifier: pkceState.codeVerifier,
    };

    const tokenResponse = yield* Effect.tryPromise({
      try: () =>
        fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tokenBody),
        }),
      catch: (cause) =>
        new JiraOAuthError({
          operation: "exchangeCode",
          detail: "Failed to exchange authorization code",
          cause,
        }),
    });

    if (!tokenResponse.ok) {
      const body = yield* Effect.tryPromise({
        try: () => tokenResponse.text(),
        catch: () =>
          new JiraOAuthError({
            operation: "exchangeCode",
            detail: `Token exchange failed with status ${tokenResponse.status}`,
          }),
      });
      return resultPage(
        "\u274C",
        "Jira connection failed",
        "Token exchange failed.",
        body.slice(0, 500),
      );
    }

    const json = yield* Effect.tryPromise({
      try: () =>
        tokenResponse.json() as Promise<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          scope: string;
        }>,
      catch: (cause) =>
        new JiraOAuthError({
          operation: "exchangeCode",
          detail: "Failed to parse token exchange response",
          cause,
        }),
    });

    const tokens: JiraTokenSet = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      scope: json.scope,
    };

    yield* tokenService.saveTokens(tokens);

    return resultPage(
      "\u2705",
      "Jira connected successfully",
      "You can close this tab and return to MarCode.",
    );
  }).pipe(
    Effect.catch((error: JiraOAuthError | JiraTokenError) =>
      Effect.succeed(
        resultPage(
          "\u274C",
          "Jira connection failed",
          "An unexpected error occurred.",
          error.message,
        ),
      ),
    ),
  ),
);

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/;

export const jiraAttachmentProxyRouteLayer = HttpRouter.add(
  "GET",
  "/api/jira/attachment/:attachmentId",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const pathParams = yield* HttpRouter.params;
    const attachmentId = pathParams.attachmentId;
    const cloudId = url.value.searchParams.get("cloudId");

    if (!attachmentId || !cloudId) {
      return HttpServerResponse.text("Missing attachmentId or cloudId", { status: 400 });
    }

    const jiraClient = yield* JiraApiClient;
    const result = yield* jiraClient.getAttachment({
      cloudId: cloudId as typeof import("@marcode/contracts").JiraCloudId.Type,
      attachmentId: attachmentId as typeof import("@marcode/contracts").TrimmedNonEmptyString.Type,
    });

    const dataUriMatch = DATA_URI_RE.exec(result.content);
    if (dataUriMatch) {
      const mimeType = dataUriMatch[1]!;
      const base64Data = dataUriMatch[2]!;
      const buffer = Buffer.from(base64Data, "base64");
      return HttpServerResponse.uint8Array(new Uint8Array(buffer), {
        contentType: mimeType,
        headers: { "Cache-Control": "private, max-age=3600" },
      });
    }

    return HttpServerResponse.text(result.content, {
      contentType: result.mimeType,
    });
  }).pipe(
    Effect.catch((error: JiraApiError | JiraTokenError) =>
      Effect.succeed(HttpServerResponse.text(error.message, { status: 502 })),
    ),
  ),
);
