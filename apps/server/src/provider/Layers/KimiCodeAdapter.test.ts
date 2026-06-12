// @effect-diagnostics nodeBuiltinImport:off
import * as path from "node:path";
import * as os from "node:os";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  KimiCodeSettings,
  ProviderDriverKind,
  ThreadId,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeKimiCodeAdapter } from "./KimiCodeAdapter.ts";
const decodeKimiCodeSettings = Schema.decodeSync(KimiCodeSettings);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const mockAgentCommand = process.execPath;

async function makeMockKimiCodeWrapper(extraEnv?: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kimi-code-acp-mock-"));
  const wrapperPath = path.join(dir, "fake-kimi.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(mockAgentCommand)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const kimiCodeAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-kimi-code-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (binaryPath: string, options?: Parameters<typeof makeKimiCodeAdapter>[1]) =>
  makeKimiCodeAdapter(decodeKimiCodeSettings({ binaryPath }), options).pipe(Effect.orDie);

it.layer(kimiCodeAdapterTestLayer)("KimiCodeAdapterLive", (it) => {
  it.effect("starts a session and maps mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("kimi-code-mock-thread");
      const wrapperPath = yield* Effect.promise(() => makeMockKimiCodeWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);

      const runtimeEvents: ProviderRuntimeEvent[] = [];
      const turnCompleted = yield* Deferred.make<void>();
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }).pipe(
          Effect.andThen(
            event.type === "turn.completed"
              ? Deferred.succeed(turnCompleted, undefined)
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("kimiCode"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: ProviderInstanceId.make("kimiCode"),
          model: "grok-build",
        },
      });

      assert.equal(session.provider, "kimiCode");
      assert.equal(session.model, "grok-build");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      yield* adapter.sendTurn({
        threadId,
        input: "hello kimi",
        attachments: [],
      });

      yield* Deferred.await(turnCompleted);
      yield* Fiber.interrupt(runtimeEventsFiber);
      const types = runtimeEvents.map((e) => e.type);

      assert.includeMembers(types, [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "item.started",
        "content.delta",
        "turn.completed",
      ] as const);

      const delta = runtimeEvents.find((e) => e.type === "content.delta");
      assert.isDefined(delta);
      if (delta?.type === "content.delta") {
        assert.equal(delta.payload.delta, "hello from mock");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("rejects startSession when provider mismatches", () =>
    Effect.gen(function* () {
      const wrapperPath = yield* Effect.promise(() => makeMockKimiCodeWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);
      const threadId = ThreadId.make("kimi-code-provider-mismatch");

      const error = yield* Effect.flip(
        adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("cursor"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: ProviderInstanceId.make("kimiCode"),
            model: "kimi-code/kimi-for-coding",
          },
        }),
      );

      assert.equal(error._tag, "ProviderAdapterValidationError");
    }),
  );

  it.effect("rejects sendTurn with empty input and no attachments", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("kimi-code-empty-turn");

      const wrapperPath = yield* Effect.promise(() => makeMockKimiCodeWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("kimiCode"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: ProviderInstanceId.make("kimiCode"),
          model: "grok-build",
        },
      });

      const error = yield* Effect.flip(
        adapter.sendTurn({
          threadId,
          input: "   ",
          attachments: [],
        }),
      );

      assert.equal(error._tag, "ProviderAdapterValidationError");

      yield* adapter.stopSession(threadId);
    }),
  );
});
