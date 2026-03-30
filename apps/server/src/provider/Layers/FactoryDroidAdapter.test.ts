import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  class TinyEmitter {
    private listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();

    on(event: string, listener: (...args: Array<unknown>) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (...args: Array<unknown>) => void): this {
      const onceListener = (...args: Array<unknown>) => {
        this.off(event, onceListener);
        listener(...args);
      };
      return this.on(event, onceListener);
    }

    off(event: string, listener: (...args: Array<unknown>) => void): this {
      const listeners = this.listeners.get(event);
      if (!listeners) {
        return this;
      }
      this.listeners.set(
        event,
        listeners.filter((candidate) => candidate !== listener),
      );
      return this;
    }

    emit(event: string, ...args: Array<unknown>): boolean {
      const listeners = this.listeners.get(event) ?? [];
      for (const listener of listeners.slice()) {
        listener(...args);
      }
      return listeners.length > 0;
    }
  }

  class FakeChildProcess extends TinyEmitter {
    public killed = false;
    public readonly stdin = { write: vi.fn(() => true) };
    public readonly stdout = new TinyEmitter();
    public readonly stderr = new TinyEmitter();

    kill(): boolean {
      this.killed = true;
      return true;
    }
  }

  class FakeJsonRpcProcess {
    sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
      requests.push({ method, params });
      return Promise.resolve({});
    }

    sendResponse(): void {}

    stop(): void {}
  }

  return {
    requests,
    spawnMock: vi.fn(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }),
    FakeJsonRpcProcess,
  };
});

vi.mock("node:child_process", () => ({
  spawn: mocks.spawnMock,
}));

vi.mock("./FactoryDroidJsonRpc.ts", () => ({
  JsonRpcProcess: mocks.FakeJsonRpcProcess,
}));

import { FactoryDroidAdapter } from "../Services/FactoryDroidAdapter.ts";
import { FactoryDroidAdapterLive } from "./FactoryDroidAdapter.ts";

const layer = it.layer(FactoryDroidAdapterLive);

afterEach(() => {
  mocks.requests.length = 0;
  mocks.spawnMock.mockClear();
});

layer("FactoryDroidAdapterLive", (it) => {
  it.effect("sends the user message without calling set_interaction_mode", () =>
    Effect.gen(function* () {
      const adapter = yield* FactoryDroidAdapter;
      const threadId = ThreadId.makeUnsafe("factory-droid-thread");

      yield* adapter.startSession({
        provider: "factoryDroid",
        threadId,
        runtimeMode: "full-access",
        modelSelection: {
          provider: "factoryDroid",
          model: "glm-4.7",
        },
      });

      yield* adapter.sendTurn({
        threadId,
        input: "Reply with exactly: droid-ok",
        attachments: [],
      });

      assert.deepStrictEqual(
        mocks.requests.map((request) => request.method),
        ["droid.initialize_session", "droid.add_user_message"],
      );
      assert.equal(
        mocks.requests.some((request) => request.method === "droid.set_interaction_mode"),
        false,
      );
      assert.deepStrictEqual(mocks.requests[1]?.params, {
        text: "Reply with exactly: droid-ok",
      });
    }),
  );
});
