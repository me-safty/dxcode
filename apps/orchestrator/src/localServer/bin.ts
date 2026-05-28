import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import { readLocalOrchestratorConfig } from "./config.ts";
import { createLocalOrchestratorFetchHandler } from "./http.ts";
import { LocalOrchestratorStore } from "./store.ts";
import { LocalTaskRuntime } from "./t3Runtime.ts";

const config = readLocalOrchestratorConfig();
const store = new LocalOrchestratorStore(config.dbPath);
const runtime = new LocalTaskRuntime(store);
const fetch = createLocalOrchestratorFetchHandler({ config, store, runtime });

function webRequestFromNodeRequest(request: IncomingMessage) {
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers.host ?? `${config.host}:${config.port}`;
  const url = `${Array.isArray(protocol) ? protocol[0] : protocol}://${host}${request.url ?? "/"}`;
  const method = request.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
      continue;
    }
    headers.set(name, value);
  }
  const init = {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request),
    ...(method === "GET" || method === "HEAD" ? {} : { duplex: "half" as const }),
  } satisfies RequestInit & { readonly duplex?: "half" };
  return new Request(url, init);
}

const server = createServer((request, response) => {
  void fetch(webRequestFromNodeRequest(request))
    .then(async (webResponse) => {
      response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
      response.end(Buffer.from(await webResponse.arrayBuffer()));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: message }));
    });
});

server.listen(config.port, config.host, () => {
  console.log("local orchestrator listening", {
    url: `http://${config.host}:${config.port}`,
    dbPath: config.dbPath,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    server.close();
    process.exit(0);
  });
}
