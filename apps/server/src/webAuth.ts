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
    ? `<div class="auth-alert" role="alert">${escapeHtml(input.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>T3 Code Sign In</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap"
    />
    <style>
      :root {
        color-scheme: dark;
        font-family:
          "DM Sans",
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          system-ui,
          sans-serif;
        --bg: color-mix(in srgb, #09090b 95%, white);
        --bg-elevated: color-mix(in srgb, var(--bg) 92%, white);
        --panel: rgba(24, 24, 27, 0.86);
        --panel-border: rgba(255, 255, 255, 0.08);
        --panel-highlight: rgba(255, 255, 255, 0.05);
        --text: #f5f5f5;
        --muted: rgba(245, 245, 245, 0.62);
        --input-bg: rgba(255, 255, 255, 0.05);
        --input-border: rgba(255, 255, 255, 0.08);
        --ring: rgba(88, 115, 255, 0.7);
        --primary: oklch(0.588 0.217 264);
        --primary-hover: color-mix(in srgb, var(--primary) 88%, white);
        --danger-bg: rgba(239, 68, 68, 0.12);
        --danger-border: rgba(239, 68, 68, 0.32);
        --danger-text: #fca5a5;
        background: var(--bg);
        color: var(--text);
      }
      html {
        min-height: 100%;
        background: var(--bg);
      }
      body {
        margin: 0;
        min-height: 100vh;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(88, 115, 255, 0.16), transparent 34%),
          radial-gradient(circle at 20% 100%, rgba(255, 255, 255, 0.06), transparent 30%),
          linear-gradient(145deg, color-mix(in srgb, var(--bg) 88%, black) 0%, var(--bg) 58%);
        padding: 24px;
      }
      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      body::before {
        opacity: 0.55;
        background:
          radial-gradient(circle at top, rgba(59, 130, 246, 0.18), transparent 18rem),
          radial-gradient(circle at 82% 18%, rgba(255, 255, 255, 0.05), transparent 24rem);
      }
      body::after {
        opacity: 0.035;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        background-repeat: repeat;
        background-size: 256px 256px;
      }
      main {
        position: relative;
        width: min(100%, 28rem);
        border-radius: 1.5rem;
        border: 1px solid var(--panel-border);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 28%),
          var(--panel);
        box-shadow:
          0 1px 0 var(--panel-highlight) inset,
          0 24px 80px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(18px);
        padding: 1.75rem;
      }
      .eyebrow {
        margin: 0 0 0.75rem;
        color: var(--muted);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .title {
        margin: 0;
        font-size: clamp(1.9rem, 6vw, 2.25rem);
        line-height: 1.05;
        letter-spacing: -0.04em;
        font-weight: 700;
      }
      .subtitle {
        margin: 0.75rem 0 1.5rem;
        color: var(--muted);
        line-height: 1.5;
        font-size: 0.98rem;
      }
      label {
        display: block;
        margin-bottom: 0.5rem;
        color: rgba(245, 245, 245, 0.92);
        font-size: 0.83rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        border: 1px solid var(--input-border);
        border-radius: 0.75rem;
        background: var(--input-bg);
        color: var(--text);
        padding: 0.85rem 0.95rem;
        font-family: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 0.95rem;
        line-height: 1.4;
        outline: none;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease,
          background-color 160ms ease;
      }
      input::placeholder {
        color: rgba(245, 245, 245, 0.32);
      }
      input:focus {
        border-color: rgba(88, 115, 255, 0.72);
        box-shadow: 0 0 0 3px rgba(88, 115, 255, 0.18);
        background: rgba(255, 255, 255, 0.07);
      }
      button {
        width: 100%;
        margin-top: 1rem;
        border: 1px solid rgba(88, 115, 255, 0.78);
        border-radius: 0.75rem;
        background: var(--primary);
        color: white;
        font-weight: 600;
        font-size: 0.95rem;
        padding: 0.85rem 1rem;
        cursor: pointer;
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.16) inset,
          0 10px 28px rgba(88, 115, 255, 0.28);
        transition:
          background-color 160ms ease,
          transform 160ms ease,
          box-shadow 160ms ease;
      }
      button:hover {
        background: var(--primary-hover);
        transform: translateY(-1px);
      }
      button:focus-visible {
        outline: none;
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.16) inset,
          0 0 0 3px rgba(88, 115, 255, 0.18),
          0 10px 28px rgba(88, 115, 255, 0.28);
      }
      button:active {
        transform: translateY(0);
      }
      .auth-alert {
        margin: 0 0 1rem;
        border: 1px solid var(--danger-border);
        border-radius: 0.875rem;
        background: var(--danger-bg);
        color: var(--danger-text);
        padding: 0.8rem 0.95rem;
        font-size: 0.88rem;
        line-height: 1.45;
      }
      .auth-form {
        display: grid;
        gap: 0.2rem;
      }
      .auth-shell {
        position: relative;
        width: 100%;
        display: flex;
        justify-content: center;
      }
      @media (max-width: 640px) {
        body {
          padding: 1rem;
          align-items: flex-start;
        }
        main {
          margin-top: min(14vh, 5rem);
          padding: 1.25rem;
        }
        .subtitle {
          font-size: 0.94rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="auth-shell">
      <main data-auth-page="t3code-sign-in">
        <p class="eyebrow">T3 Code Secure Access</p>
        <h1 class="title">Open T3 Code</h1>
        <p class="subtitle">Use your access link or enter the auth token to continue.</p>
        ${errorMarkup}
        <form method="post" action="/auth/login" class="auth-form">
        <input type="hidden" name="next" value="${escapeHtml(input.nextPath)}" />
        <label for="token">Auth token</label>
        <input
          id="token"
          name="token"
          type="password"
          autocomplete="current-password"
          spellcheck="false"
          required
        />
        <button type="submit">Continue</button>
        </form>
      </main>
    </div>
  </body>
</html>`;
}
