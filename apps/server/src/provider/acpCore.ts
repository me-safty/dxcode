import type { ProviderKind, ProviderSession, ThreadId, TurnId } from "@t3tools/contracts";
import { Effect } from "effect";
import * as ChildProcess from "node:child_process";
import * as readline from "node:readline";

import { ProviderAdapterProcessError, ProviderAdapterRequestError } from "./Errors.ts";

export const ACP_VERSION = 1;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface AcpSessionState {
  readonly threadId: ThreadId;
  readonly process: ChildProcess.ChildProcess;
  readonly rl: readline.Interface;
  readonly pendingRequests: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >;
  nextId: number;
  acpSessionId: string | null;
  activeTurnId: TurnId | null;
  status: ProviderSession["status"];
  cwd: string | undefined;
  readonly model?: string;
  createdAt: string;
}

function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && !("method" in message);
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

function sendMessage(
  session: AcpSessionState,
  message: JsonRpcRequest | JsonRpcNotification,
): void {
  session.process.stdin?.write(`${JSON.stringify(message)}\n`);
}

export function sendAcpRequest(
  session: AcpSessionState,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const id = session.nextId++;
  return new Promise((resolve, reject) => {
    session.pendingRequests.set(id, { resolve, reject });
    sendMessage(session, { jsonrpc: "2.0", id, method, params });
  });
}

export function sendAcpNotification(
  session: AcpSessionState,
  method: string,
  params?: unknown,
): void {
  sendMessage(session, { jsonrpc: "2.0", method, params });
}

export function spawnAcpProcessSession(input: {
  provider: ProviderKind;
  threadId: ThreadId;
  binaryPath: string;
  args: ReadonlyArray<string>;
  cwd: string;
  model?: string;
}): Effect.Effect<AcpSessionState, ProviderAdapterProcessError> {
  return Effect.try({
    try: () => {
      const child = ChildProcess.spawn(input.binaryPath, [...input.args], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: input.cwd,
        env: { ...process.env },
      });

      if (!child.stdin || !child.stdout) {
        child.kill();
        throw new ProviderAdapterProcessError({
          provider: input.provider,
          threadId: input.threadId,
          detail: "Failed to spawn ACP process: missing stdio",
        });
      }

      return {
        threadId: input.threadId,
        process: child,
        rl: readline.createInterface({ input: child.stdout, crlfDelay: Infinity }),
        pendingRequests: new Map(),
        nextId: 1,
        acpSessionId: null,
        activeTurnId: null,
        status: "connecting",
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        createdAt: new Date().toISOString(),
      } satisfies AcpSessionState;
    },
    catch: (cause) =>
      cause instanceof ProviderAdapterProcessError
        ? cause
        : new ProviderAdapterProcessError({
            provider: input.provider,
            threadId: input.threadId,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
  });
}

export function wireAcpProcessMessages(input: {
  session: AcpSessionState;
  onNotification: (method: string, params: unknown) => Effect.Effect<void>;
  onUnhandledNotification?: (method: string) => Effect.Effect<void>;
  onUnhandledMessage?: (message: JsonRpcMessage) => Effect.Effect<void>;
  onExit?: () => Effect.Effect<void>;
}): void {
  input.session.rl.on("line", (line: string) => {
    if (!line.trim()) {
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (isResponse(message)) {
      const pending = input.session.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      input.session.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isNotification(message)) {
      if (message.method === "session/update") {
        Effect.runPromise(input.onNotification(message.method, message.params)).catch(() => {});
        return;
      }
      if (input.onUnhandledNotification) {
        Effect.runPromise(input.onUnhandledNotification(message.method)).catch(() => {});
      }
      return;
    }

    if (input.onUnhandledMessage) {
      Effect.runPromise(input.onUnhandledMessage(message)).catch(() => {});
    }
  });

  input.session.process.on("exit", () => {
    input.session.status = "closed";
    for (const [, pending] of input.session.pendingRequests) {
      pending.reject(new Error("ACP process exited"));
    }
    input.session.pendingRequests.clear();
    if (input.onExit) {
      Effect.runPromise(input.onExit()).catch(() => {});
    }
  });

  input.session.process.stderr?.on("data", () => {});
}

export function initializeAcpSession(input: {
  provider: ProviderKind;
  session: AcpSessionState;
  clientName: string;
  clientVersion: string;
  capabilities?: Record<string, unknown>;
}): Effect.Effect<Record<string, unknown> | undefined, ProviderAdapterProcessError> {
  return Effect.tryPromise({
    try: async () => {
      const result = (await sendAcpRequest(input.session, "initialize", {
        protocolVersion: ACP_VERSION,
        client_info: { name: input.clientName, version: input.clientVersion },
        capabilities: input.capabilities ?? {},
      })) as Record<string, unknown> | undefined;
      sendAcpNotification(input.session, "initialized");
      return result;
    },
    catch: (cause) =>
      new ProviderAdapterProcessError({
        provider: input.provider,
        threadId: input.session.threadId,
        detail: `ACP initialization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
}

export function createAcpRemoteSession(input: {
  provider: ProviderKind;
  session: AcpSessionState;
  cwd: string;
  mcpServers?: ReadonlyArray<unknown>;
}): Effect.Effect<{ sessionId?: string } | undefined, ProviderAdapterRequestError> {
  return Effect.tryPromise({
    try: async () => {
      const result = (await sendAcpRequest(input.session, "session/new", {
        cwd: input.cwd,
        mcpServers: input.mcpServers ?? [],
      })) as { sessionId?: string } | undefined;
      input.session.acpSessionId = result?.sessionId ?? null;
      return result;
    },
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: input.provider,
        method: "session/new",
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
}

export function stopAcpProcessSession(session: AcpSessionState): void {
  session.rl.close();
  session.process.kill();
  session.status = "closed";
}
