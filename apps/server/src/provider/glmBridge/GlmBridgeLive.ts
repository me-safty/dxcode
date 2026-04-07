import { Data, Effect, Layer, Ref } from "effect";
import * as http from "node:http";

import { ServerSettingsService } from "../../serverSettings.ts";
import { GlmBridgeService, type GlmBridgeShape } from "./GlmBridgeService.ts";
import {
  translateResponsesToChatCompletions,
  UnsupportedResponsesFeatureError,
  type ResponsesRequest,
} from "./translateResponsesToGlm.ts";
import {
  GlmToResponsesTranslator,
  formatResponsesSSE,
  type ChatCompletionsChunk,
} from "./translateGlmToResponses.ts";

class GlmBridgeStartError extends Data.TaggedError("GlmBridgeStartError")<{
  readonly cause: unknown;
}> {}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleResponsesRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamBaseUrl: string,
): Promise<void> {
  let responsesReq: ResponsesRequest;
  try {
    const bodyText = await readRequestBody(req);
    responsesReq = JSON.parse(bodyText) as ResponsesRequest;
  } catch {
    jsonResponse(res, 400, { error: { message: "Invalid JSON request body" } });
    return;
  }

  let chatReq;
  try {
    chatReq = translateResponsesToChatCompletions(responsesReq);
  } catch (err) {
    if (err instanceof UnsupportedResponsesFeatureError) {
      jsonResponse(res, 400, { error: { message: err.message } });
      return;
    }
    jsonResponse(res, 500, {
      error: { message: "Bridge translation error", detail: String(err) },
    });
    return;
  }

  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    jsonResponse(res, 401, {
      error: { message: "GLM_API_KEY environment variable is not set" },
    });
    return;
  }

  const upstreamUrl = `${upstreamBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const abortController = new AbortController();

  req.on("close", () => abortController.abort());

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(chatReq),
      signal: abortController.signal,
    });
  } catch (err) {
    if (abortController.signal.aborted) return;
    jsonResponse(res, 502, {
      error: {
        message: "Failed to connect to upstream GLM API",
        detail: String(err),
        upstream_url: upstreamUrl,
      },
    });
    return;
  }

  if (!upstreamRes.ok) {
    let errorBody = "";
    try {
      errorBody = await upstreamRes.text();
    } catch {}
    jsonResponse(res, upstreamRes.status, {
      error: {
        message: `Upstream GLM API returned ${upstreamRes.status}`,
        detail: errorBody,
        upstream_url: upstreamUrl,
      },
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const responseId = `resp_glm_${Date.now()}`;
  const translator = new GlmToResponsesTranslator(responseId);

  res.write(
    formatResponsesSSE({
      event: "response.created",
      data: { response: { id: responseId, status: "in_progress" } },
    }),
  );

  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    res.write(
      formatResponsesSSE({
        event: "response.completed",
        data: { response: { id: responseId, status: "failed" } },
      }),
    );
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") continue;

        let chunk: ChatCompletionsChunk;
        try {
          chunk = JSON.parse(dataStr) as ChatCompletionsChunk;
        } catch {
          continue;
        }

        const events = translator.translateChunk(chunk);
        for (const event of events) {
          res.write(formatResponsesSSE(event));
        }
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      res.write(
        formatResponsesSSE({
          event: "response.completed",
          data: {
            response: {
              id: responseId,
              status: "failed",
              error: { message: String(err) },
            },
          },
        }),
      );
    }
  } finally {
    res.end();
  }
}

async function handleModelsRequest(
  res: http.ServerResponse,
  upstreamBaseUrl: string,
): Promise<void> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    jsonResponse(res, 401, {
      error: { message: "GLM_API_KEY environment variable is not set" },
    });
    return;
  }

  const upstreamUrl = `${upstreamBaseUrl.replace(/\/+$/, "")}/models`;
  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      "Content-Type": "application/json",
    });
    res.end(body);
  } catch (err) {
    jsonResponse(res, 502, {
      error: { message: "Failed to proxy models request", detail: String(err) },
    });
  }
}

export const GlmBridgeLive = Layer.effect(
  GlmBridgeService,
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const settings = yield* settingsService.getSettings;
    let currentUpstreamBaseUrl = settings.providers.glm.upstreamBaseUrl;
    const baseUrlRef = yield* Ref.make<string>("");

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/health") {
        jsonResponse(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/responses") {
        await handleResponsesRequest(req, res, currentUpstreamBaseUrl);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/models") {
        await handleModelsRequest(res, currentUpstreamBaseUrl);
        return;
      }

      jsonResponse(res, 404, { error: { message: `Not found: ${pathname}` } });
    });

    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.listen(0, "127.0.0.1", () => resolve());
          server.on("error", (err) => reject(err));
        }),
      catch: (err) => new GlmBridgeStartError({ cause: err }),
    });

    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const bridgeBaseUrl = `http://127.0.0.1:${port}/v1`;
    yield* Ref.set(baseUrlRef, bridgeBaseUrl);

    yield* Effect.log(`GLM bridge started on ${bridgeBaseUrl}`);

    return {
      baseUrl: Ref.get(baseUrlRef),
    } satisfies GlmBridgeShape;
  }),
);
