import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const API_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1.1.0";

export type JsonRpcRequest = {
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

export class JsonRpcProcess {
  private rpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly onNotification: (msg: Record<string, unknown>) => void,
    private readonly onRequest: (
      method: string,
      id: string,
      params: Record<string, unknown>,
    ) => void,
  ) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const t = msg.type as string | undefined;

      if (t === "response") {
        const id = msg.id as string | null;
        if (!id) return;
        const pending = this.rpc.get(id);
        if (pending) {
          this.rpc.delete(id);
          if (msg.error) {
            pending.reject(
              new Error((msg.error as { message?: string }).message ?? "JSON-RPC error"),
            );
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      if (t === "notification") {
        const method = msg.method as string | undefined;
        const notif = (msg.params as { notification?: Record<string, unknown> })?.notification;
        if (method === "droid.session_notification") {
          if (notif) this.onNotification(notif);
          return;
        }
        if (notif) {
          this.onNotification(notif);
          return;
        }
        return;
      }

      if (t === "request") {
        const method = msg.method as string;
        const id = msg.id as string;
        const params = (msg.params as Record<string, unknown> | undefined) ?? {};
        this.onRequest(method, id, params);
      }
    });
  }

  public sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.child.killed) {
        reject(new Error("Child process not available"));
        return;
      }
      const id = randomUUID();
      this.rpc.set(id, { resolve, reject });
      this.child.stdin.write(
        JSON.stringify({
          factoryApiVersion: API_VERSION,
          factoryProtocolVersion: PROTOCOL_VERSION,
          type: "request",
          jsonrpc: "2.0",
          id,
          method,
          params,
        }) + "\n",
      );
    });
  }

  public sendResponse(id: string, result: unknown): void {
    if (this.child.killed) return;
    this.child.stdin.write(
      JSON.stringify({
        factoryApiVersion: API_VERSION,
        factoryProtocolVersion: PROTOCOL_VERSION,
        type: "response",
        jsonrpc: "2.0",
        id,
        result,
      }) + "\n",
    );
  }

  public stop(): void {
    for (const [, p] of this.rpc) p.reject(new Error("Session stopped"));
    this.rpc.clear();
  }
}
