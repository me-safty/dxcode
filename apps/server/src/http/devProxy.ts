import * as Effect from "effect/Effect";
import type * as HttpHeaders from "effect/unstable/http/Headers";
import { HttpClient, HttpServerResponse } from "effect/unstable/http";

const DEV_PROXY_DENIED_PREFIXES = ["/api", "/.well-known", "/attachments", "/ws"] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "content-length",
] as const;

export function resolveDevProxyTargetUrl(devUrl: URL, requestUrl: URL): string {
  const targetUrl = new URL(devUrl.toString());
  targetUrl.pathname = requestUrl.pathname;
  targetUrl.search = requestUrl.search;
  targetUrl.hash = requestUrl.hash;
  return targetUrl.toString();
}

export function isDevProxyDeniedPath(pathname: string): boolean {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return DEV_PROXY_DENIED_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

function pickForwardedHeaders(headers: HttpHeaders.Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = headers[name];
    if (value !== undefined) {
      output[name] = value;
    }
  }
  return output;
}

export const proxyGetToDevUrl = Effect.fn("proxyGetToDevUrl")(function* (input: {
  readonly devUrl: URL;
  readonly requestUrl: URL;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const targetUrl = resolveDevProxyTargetUrl(input.devUrl, input.requestUrl);

  return yield* httpClient.get(targetUrl).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        const body = new Uint8Array(yield* response.arrayBuffer);
        const headers = pickForwardedHeaders(response.headers);
        const contentType = headers["content-type"];

        return HttpServerResponse.uint8Array(body, {
          status: response.status,
          ...(contentType ? { contentType } : {}),
          headers,
        });
      }),
    ),
    Effect.catch(() =>
      Effect.succeed(
        HttpServerResponse.text(
          `Vite dev server unreachable at ${input.devUrl.origin}. Start the web dev server and try again.`,
          { status: 503 },
        ),
      ),
    ),
  );
});
