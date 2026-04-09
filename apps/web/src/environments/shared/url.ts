export function resolveHttpUrlFromBase(input: {
  readonly httpBaseUrl: string;
  readonly pathname: string;
  readonly searchParams?: Record<string, string>;
}): string {
  const url = new URL(input.httpBaseUrl);
  url.pathname = input.pathname;
  url.search = input.searchParams ? new URLSearchParams(input.searchParams).toString() : "";
  return url.toString();
}

export function createWebSocketBaseUrlFromHttpBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Unsupported HTTP base URL protocol: ${url.protocol}`);
  }
  return url.toString();
}
