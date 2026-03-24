import type http from "node:http";

import type { ServerConfigShape } from "./config";

export const AUTH_COOKIE_NAME = "t3code_auth";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_COOKIE_MAX_AGE_PAST = 0;

export function isProtectedWebAuthEnabled(config: ServerConfigShape): boolean {
  return (
    config.mode === "web" && config.devUrl === undefined && typeof config.authToken === "string"
  );
}

export function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }

  return cookies;
}

export function isSecureRequest(request: http.IncomingMessage): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    const proto = forwardedProto.split(",")[0]?.trim().toLowerCase();
    if (proto === "https") return true;
  }
  return Boolean((request.socket as { encrypted?: boolean }).encrypted);
}

export function createAuthCookieHeader(token: string, secure: boolean): string {
  const attributes = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function createExpiredAuthCookieHeader(secure: boolean): string {
  const attributes = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_PAST}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function appendSetCookieHeader(
  headers: Record<string, string | string[]>,
  cookie: string,
): Record<string, string | string[]> {
  const existing = headers["Set-Cookie"];
  if (!existing) {
    headers["Set-Cookie"] = cookie;
    return headers;
  }
  headers["Set-Cookie"] = Array.isArray(existing) ? [...existing, cookie] : [existing, cookie];
  return headers;
}

export function sanitizeNextPath(candidate: string | null | undefined): string {
  if (!candidate || typeof candidate !== "string") return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//")) return "/";

  try {
    const parsed = new URL(candidate, "http://localhost");
    if (parsed.origin !== "http://localhost") return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function removeTokenFromRequestUrl(url: URL): string {
  const next = new URL(url.pathname + url.search, "http://localhost");
  next.searchParams.delete("token");
  const search = next.searchParams.toString();
  return `${next.pathname}${search.length > 0 ? `?${search}` : ""}`;
}

export function requestPrefersHtml(request: http.IncomingMessage, url: URL): boolean {
  const method = request.method?.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/attachments/")) return false;

  const accept = request.headers.accept?.toLowerCase() ?? "";
  if (accept.includes("text/html") || accept.includes("application/xhtml+xml")) {
    return true;
  }

  if (url.pathname === "/") return true;

  const lastSegment = url.pathname.split("/").at(-1) ?? "";
  return !lastSegment.includes(".");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderAuthPage(input: {
  readonly nextPath: string;
  readonly error?: string;
}): string {
  const errorMarkup = input.error
    ? `<p style="margin:0 0 16px;color:#b91c1c;font-size:14px;">${escapeHtml(input.error)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>T3 Code Sign In</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f3f4f6;
        color: #111827;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(14, 165, 233, 0.12), transparent 36%),
          linear-gradient(180deg, #f8fafc, #eef2ff 70%, #e5e7eb);
        padding: 24px;
      }
      main {
        width: min(100%, 420px);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.28);
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0 0 20px;
        color: #475569;
        line-height: 1.5;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 15px;
      }
      button {
        width: 100%;
        margin-top: 16px;
        border: 0;
        border-radius: 12px;
        background: #0f172a;
        color: white;
        font-weight: 600;
        font-size: 15px;
        padding: 12px 14px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Open T3 Code</h1>
      <p>Use your access link or enter the auth token to continue.</p>
      ${errorMarkup}
      <form method="post" action="/auth/login">
        <input type="hidden" name="next" value="${escapeHtml(input.nextPath)}" />
        <label for="token">Auth token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" required />
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>`;
}
