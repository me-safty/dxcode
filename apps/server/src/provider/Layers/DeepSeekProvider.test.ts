import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DeepSeekSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";

import { checkDeepSeekProviderStatus } from "./DeepSeekProvider.ts";

const encoder = new TextEncoder();
const defaultDeepSeekSettings: DeepSeekSettings = Schema.decodeSync(DeepSeekSettings)({
  apiKey: "sk-deepseek",
});

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function recordingMockSpawnerLayer(
  handler: (args: ReadonlyArray<string>) => {
    stdout: string;
    stderr: string;
    code: number;
  },
) {
  const commands: Array<{
    readonly args: ReadonlyArray<string>;
    readonly env: NodeJS.ProcessEnv | undefined;
  }> = [];
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as {
        args: ReadonlyArray<string>;
        options?: {
          readonly env?: NodeJS.ProcessEnv;
        };
      };
      commands.push({ args: cmd.args, env: cmd.options?.env });
      return Effect.succeed(mockHandle(handler(cmd.args)));
    }),
  );
  return { layer, commands };
}

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

it.layer(NodeServices.layer)("DeepSeekProvider", (it) => {
  it.effect("injects DeepSeek's Anthropic-compatible Claude environment", () => {
    const recorded = recordingMockSpawnerLayer((args) => {
      const joined = args.join(" ");
      if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
      throw new Error(`Unexpected args: ${joined}`);
    });

    return Effect.gen(function* () {
      const status = yield* checkDeepSeekProviderStatus(defaultDeepSeekSettings);

      assert.strictEqual(status.status, "ready");
      assert.strictEqual(status.auth.status, "authenticated");
      assert.strictEqual(status.auth.label, "DeepSeek API Key");
      assert.deepStrictEqual(recorded.commands[0]?.env, {
        ...process.env,
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
        ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4-flash",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      });
    }).pipe(Effect.provide(recorded.layer));
  });

  it.effect("returns a clear error when the DeepSeek API key is missing", () =>
    Effect.gen(function* () {
      const status = yield* checkDeepSeekProviderStatus({
        ...defaultDeepSeekSettings,
        apiKey: "",
      });

      assert.strictEqual(status.status, "error");
      assert.strictEqual(status.auth.status, "unauthenticated");
      assert.strictEqual(status.message, "DeepSeek API key is missing.");
    }).pipe(Effect.provide(failingSpawnerLayer("spawn claude ENOENT"))),
  );

  it.effect("exposes only DeepSeek Pro 1M and Flash models", () => {
    const recorded = recordingMockSpawnerLayer((args) => {
      const joined = args.join(" ");
      if (joined === "--version") return { stdout: "1.0.0\n", stderr: "", code: 0 };
      throw new Error(`Unexpected args: ${joined}`);
    });

    return Effect.gen(function* () {
      const status = yield* checkDeepSeekProviderStatus(defaultDeepSeekSettings);

      assert.deepStrictEqual(
        status.models.map((model) => ({ slug: model.slug, name: model.name })),
        [
          { slug: "deepseek-v4-pro[1m]", name: "DeepSeek V4 Pro 1M" },
          { slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        ],
      );
    }).pipe(Effect.provide(recorded.layer));
  });
});
