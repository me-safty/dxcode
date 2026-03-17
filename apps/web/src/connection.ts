import type { DesktopConnectionMode } from "@t3tools/contracts";

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildDefaultWsUrl(input: {
  pageProtocol: string;
  pageHost: string;
  pageHostname: string;
}): string {
  const protocol = input.pageProtocol === "https:" ? "wss" : "ws";
  const host = asNonEmptyString(input.pageHost) ?? input.pageHostname;
  return `${protocol}://${host}`;
}

export function resolveWsUrlFromSources(input: {
  explicitUrl?: string | null | undefined;
  bridgeWsUrl?: string | null | undefined;
  envWsUrl?: string | null | undefined;
  pageProtocol: string;
  pageHost: string;
  pageHostname: string;
}): string {
  return (
    asNonEmptyString(input.explicitUrl) ??
    asNonEmptyString(input.bridgeWsUrl) ??
    asNonEmptyString(input.envWsUrl) ??
    buildDefaultWsUrl({
      pageProtocol: input.pageProtocol,
      pageHost: input.pageHost,
      pageHostname: input.pageHostname,
    })
  );
}

export function resolveRuntimeWsUrl(explicitUrl?: string): string {
  if (typeof window === "undefined") {
    return explicitUrl ?? "ws://localhost:3773";
  }

  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  return resolveWsUrlFromSources({
    explicitUrl,
    bridgeWsUrl,
    envWsUrl,
    pageProtocol: window.location.protocol,
    pageHost: window.location.host,
    pageHostname: window.location.hostname,
  });
}

export function resolveHttpOriginFromWsUrl(input: {
  wsUrl: string;
  fallbackOrigin: string;
}): string {
  try {
    const parsed = new URL(input.wsUrl);
    if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    } else if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    }
    return parsed.origin;
  } catch {
    return input.fallbackOrigin;
  }
}

export function resolveRuntimeHttpOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return resolveHttpOriginFromWsUrl({
    wsUrl: resolveRuntimeWsUrl(),
    fallbackOrigin: window.location.origin,
  });
}

export function resolveDesktopConnectionMode(): DesktopConnectionMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.desktopBridge?.getConnectionMode?.() ?? null;
}
