import { httpActionGeneric, httpRouter } from "convex/server";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,b3,traceparent,content-type,dpop",
  "access-control-expose-headers": "traceparent,www-authenticate",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
      ...init.headers,
    },
  });
}

function emptyCorsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpActionGeneric(async () =>
    jsonResponse({
      ok: true,
      service: "relay",
    }),
  ),
});

http.route({
  path: "/health",
  method: "OPTIONS",
  handler: httpActionGeneric(async () => emptyCorsResponse()),
});

export default http;
