import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Http from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import type { DesktopRemoteAddress, DesktopRemoteState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { NetService } from "@t3tools/shared/Net";
import { WebSocket, WebSocketServer } from "ws";

import { closeWebSocket } from "./webSocketClose";

export const DEFAULT_DESKTOP_REMOTE_PORT = 3773;

interface DesktopRemoteSettings {
  readonly enabled: boolean;
  readonly port: number;
  readonly token: string;
}

interface DesktopRemoteManagerOptions {
  readonly settingsPath: string;
  readonly getBackendPort: () => number;
  readonly getBackendAuthToken: () => string;
}

type RemoteStateListener = (state: DesktopRemoteState) => void;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function createRemoteToken(): string {
  return Crypto.randomBytes(24).toString("hex");
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function normalizeRemoteToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRemoteSettings(raw: unknown): DesktopRemoteSettings {
  const candidate = typeof raw === "object" && raw !== null ? raw : {};
  const enabled = "enabled" in candidate && candidate.enabled === true;
  const port =
    "port" in candidate && isValidPort(candidate.port)
      ? candidate.port
      : DEFAULT_DESKTOP_REMOTE_PORT;
  const token =
    ("token" in candidate ? normalizeRemoteToken(candidate.token) : null) ?? createRemoteToken();

  return {
    enabled,
    port,
    token,
  };
}

export function loadDesktopRemoteSettings(settingsPath: string): DesktopRemoteSettings {
  try {
    if (!FS.existsSync(settingsPath)) {
      return normalizeRemoteSettings(null);
    }
    const raw = FS.readFileSync(settingsPath, "utf8");
    return normalizeRemoteSettings(JSON.parse(raw));
  } catch {
    return normalizeRemoteSettings(null);
  }
}

function saveDesktopRemoteSettings(
  settingsPath: string,
  settings: DesktopRemoteSettings,
): DesktopRemoteSettings {
  const normalized = normalizeRemoteSettings(settings);
  FS.mkdirSync(Path.dirname(settingsPath), { recursive: true });
  FS.writeFileSync(settingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function parseRequestUrl(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? "/", "http://t3.remote");
  } catch {
    return null;
  }
}

function isAuthorizedRemoteRequest(rawUrl: string | undefined, token: string): boolean {
  const url = parseRequestUrl(rawUrl);
  const candidate = url?.searchParams.get("token") ?? "";
  if (candidate.length === 0 || candidate.length !== token.length) {
    return false;
  }
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const tokenBuffer = Buffer.from(token, "utf8");
  return Crypto.timingSafeEqual(candidateBuffer, tokenBuffer);
}

function buildUpstreamRequestPath(rawUrl: string | undefined, backendAuthToken: string): string {
  const url = parseRequestUrl(rawUrl) ?? new URL("/", "http://t3.remote");

  if (backendAuthToken.length > 0) {
    url.searchParams.set("token", backendAuthToken);
  } else {
    url.searchParams.delete("token");
  }

  return `${url.pathname}${url.search}`;
}

function formatRemoteUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function collectRemoteAddresses(port: number): ReadonlyArray<DesktopRemoteAddress> {
  const seenHosts = new Set<string>();
  const addresses: DesktopRemoteAddress[] = [];

  for (const [interfaceName, candidates] of Object.entries(OS.networkInterfaces())) {
    for (const candidate of candidates ?? []) {
      const family = typeof candidate.family === "string" ? candidate.family : "";
      if (candidate.internal || family !== "IPv4" || candidate.address.startsWith("169.254.")) {
        continue;
      }
      if (seenHosts.has(candidate.address)) {
        continue;
      }

      seenHosts.add(candidate.address);
      addresses.push({
        label: interfaceName,
        host: candidate.address,
        url: formatRemoteUrl(candidate.address, port),
      });
    }
  }

  return addresses.toSorted((left, right) =>
    left.label === right.label
      ? left.host.localeCompare(right.host)
      : left.label.localeCompare(right.label),
  );
}

function filterProxyHeaders(
  headers: IncomingHttpHeaders | OutgoingHttpHeaders,
): OutgoingHttpHeaders {
  const nextHeaders: OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    nextHeaders[name] = value;
  }

  return nextHeaders;
}

function writeSocketError(socket: Net.Socket, statusCode: number, message: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${message}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(message, "utf8")}`,
      "",
      message,
    ].join("\r\n"),
  );
  socket.destroy();
}

export class DesktopRemoteManager {
  private readonly listeners = new Set<RemoteStateListener>();
  private readonly sockets = new Set<Net.Socket>();
  private readonly settingsPath: string;
  private settings: DesktopRemoteSettings;
  private server: Http.Server | null = null;
  private websocketServer: WebSocketServer | null = null;
  private listeningPort = 0;
  private errorMessage: string | null = null;
  private starting = false;
  private startingPromise: Promise<void> | null = null;

  constructor(private readonly options: DesktopRemoteManagerOptions) {
    this.settingsPath = options.settingsPath;
    this.settings = saveDesktopRemoteSettings(
      this.settingsPath,
      loadDesktopRemoteSettings(options.settingsPath),
    );
  }

  getState(): DesktopRemoteState {
    const port = this.listeningPort > 0 ? this.listeningPort : this.settings.port;
    return {
      enabled: this.settings.enabled,
      listening: this.server !== null,
      port,
      token: this.settings.token,
      endpoints: collectRemoteAddresses(port),
      errorMessage: this.errorMessage,
    };
  }

  subscribe(listener: RemoteStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startIfEnabled(): Promise<DesktopRemoteState> {
    if (this.settings.enabled) {
      await this.startServer();
    } else {
      this.errorMessage = null;
    }
    this.emit();
    return this.getState();
  }

  async setEnabled(enabled: boolean): Promise<DesktopRemoteState> {
    this.settings = saveDesktopRemoteSettings(this.settingsPath, {
      ...this.settings,
      enabled,
    });

    if (enabled) {
      await this.startServer();
    } else {
      this.errorMessage = null;
      await this.stopServer();
    }

    this.emit();
    return this.getState();
  }

  async setToken(rawToken: string): Promise<DesktopRemoteState> {
    const token = normalizeRemoteToken(rawToken);
    if (!token || token === this.settings.token) {
      return this.getState();
    }

    this.settings = saveDesktopRemoteSettings(this.settingsPath, {
      ...this.settings,
      token,
    });

    if (this.server) {
      await this.stopServer();
      await this.startServer();
    }

    this.emit();
    return this.getState();
  }

  async close(): Promise<void> {
    this.errorMessage = null;
    await this.stopServer();
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private async resolveListeningPort(): Promise<number> {
    return Effect.service(NetService).pipe(
      Effect.flatMap((net) => net.findAvailablePort(this.settings.port)),
      Effect.provide(NetService.layer),
      Effect.runPromise,
    );
  }

  private async startServer(): Promise<void> {
    if (this.server || this.starting) {
      return;
    }
    this.starting = true;
    this.startingPromise = this.doStartServer();
    await this.startingPromise;
    this.startingPromise = null;
  }

  private async doStartServer(): Promise<void> {
    const backendPort = this.options.getBackendPort();
    if (!isValidPort(backendPort)) {
      this.starting = false;
      this.errorMessage = "Desktop backend is not ready yet.";
      return;
    }

    try {
      const listeningPort = await this.resolveListeningPort();
      if (listeningPort !== this.settings.port) {
        this.settings = saveDesktopRemoteSettings(this.settingsPath, {
          ...this.settings,
          port: listeningPort,
        });
      }

      const server = Http.createServer((request, response) => {
        this.handleHttpRequest(request, response);
      });
      const websocketServer = new WebSocketServer({ noServer: true });

      server.on("connection", (socket) => {
        this.sockets.add(socket);
        socket.on("close", () => {
          this.sockets.delete(socket);
        });
      });

      server.on("upgrade", (request, socket, head) => {
        this.handleUpgradeRequest(request, socket as Net.Socket, head, websocketServer);
      });

      await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => {
          server.off("listening", handleListening);
          reject(error);
        };
        const handleListening = () => {
          server.off("error", handleError);
          resolve();
        };
        server.once("error", handleError);
        server.once("listening", handleListening);
        server.listen(listeningPort, "0.0.0.0");
      });

      server.on("close", () => {
        if (this.server === server) {
          this.server = null;
          this.listeningPort = 0;
          this.emit();
        }
      });

      server.on("error", (error) => {
        this.errorMessage = error.message;
        this.emit();
      });

      this.server = server;
      this.websocketServer = websocketServer;
      this.listeningPort = listeningPort;
      this.errorMessage = null;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : "Failed to start remote access.";
    } finally {
      this.starting = false;
    }
  }

  private async stopServer(): Promise<void> {
    if (this.startingPromise) {
      await this.startingPromise;
    }

    const server = this.server;
    if (!server) {
      this.listeningPort = 0;
      return;
    }

    this.server = null;
    this.listeningPort = 0;

    for (const client of this.websocketServer?.clients ?? []) {
      client.terminate();
    }
    const wss = this.websocketServer;
    this.websocketServer = null;
    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    }

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private handleHttpRequest(request: Http.IncomingMessage, response: Http.ServerResponse): void {
    if (!isAuthorizedRemoteRequest(request.url, this.settings.token)) {
      response.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unauthorized remote request");
      return;
    }

    const backendPort = this.options.getBackendPort();
    if (!isValidPort(backendPort)) {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Desktop backend unavailable");
      return;
    }

    const upstreamRequest = Http.request(
      {
        host: "127.0.0.1",
        port: backendPort,
        method: request.method ?? "GET",
        path: buildUpstreamRequestPath(request.url, this.options.getBackendAuthToken()),
        headers: {
          ...filterProxyHeaders(request.headers),
          host: `127.0.0.1:${backendPort}`,
        },
      },
      (upstreamResponse) => {
        upstreamResponse.on("error", () => {
          response.destroy();
        });
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          filterProxyHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(response);
      },
    );

    upstreamRequest.on("error", () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Failed to proxy remote request");
    });

    request.on("aborted", () => {
      upstreamRequest.destroy();
    });

    request.pipe(upstreamRequest);
  }

  private handleUpgradeRequest(
    request: Http.IncomingMessage,
    socket: Net.Socket,
    head: Buffer,
    websocketServer: WebSocketServer,
  ): void {
    socket.on("error", (error) => {
      // Log upgrade-phase socket errors for debugging without crashing.
      console.warn("[remote] WebSocket upgrade socket error:", error.message);
    });

    if (!isAuthorizedRemoteRequest(request.url, this.settings.token)) {
      writeSocketError(socket, 401, "Unauthorized remote request");
      return;
    }

    const backendPort = this.options.getBackendPort();
    if (!isValidPort(backendPort)) {
      writeSocketError(socket, 503, "Desktop backend unavailable");
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
      const upstreamSocket = new WebSocket(
        `ws://127.0.0.1:${backendPort}${buildUpstreamRequestPath(request.url, this.options.getBackendAuthToken())}`,
      );
      const MAX_PENDING_MESSAGES = 256;
      const pendingClientMessages: Array<{ data: Buffer; isBinary: boolean }> = [];

      const closeClient = (code?: number, reason?: Buffer | string) => {
        closeWebSocket(clientSocket, code, reason);
      };

      const closeUpstream = (code?: number, reason?: Buffer | string) => {
        closeWebSocket(upstreamSocket, code, reason);
      };

      clientSocket.on("message", (data, isBinary) => {
        if (upstreamSocket.readyState === WebSocket.CONNECTING) {
          if (pendingClientMessages.length >= MAX_PENDING_MESSAGES) {
            closeClient(1008, "Too many buffered messages");
            closeUpstream();
            return;
          }
          const bufferedData = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data);
          pendingClientMessages.push({
            data: bufferedData,
            isBinary,
          });
          return;
        }
        if (upstreamSocket.readyState !== WebSocket.OPEN) {
          return;
        }
        upstreamSocket.send(data, { binary: isBinary });
      });

      upstreamSocket.on("open", () => {
        for (const pendingMessage of pendingClientMessages) {
          upstreamSocket.send(pendingMessage.data, { binary: pendingMessage.isBinary });
        }
        pendingClientMessages.length = 0;
      });

      upstreamSocket.on("message", (data, isBinary) => {
        if (clientSocket.readyState !== WebSocket.OPEN) {
          return;
        }
        clientSocket.send(data, { binary: isBinary });
      });

      clientSocket.on("close", (code, reason) => {
        closeUpstream(code, reason);
      });

      upstreamSocket.on("close", (code, reason) => {
        closeClient(code, reason);
      });

      clientSocket.on("error", () => {
        closeUpstream();
      });

      upstreamSocket.on("error", () => {
        closeClient(1011, "Remote backend connection failed");
      });
    });
  }
}
