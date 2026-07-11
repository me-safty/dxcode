import * as NodeServices from "@effect/platform-node/NodeServices";
import { KiloSettings, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { KiloRuntime, KiloRuntimeError, type KiloRuntimeShape } from "../provider/kiloRuntime.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { makeKiloTextGeneration, sanitizeKiloBranchName } from "./KiloTextGeneration.ts";

const isTextGenerationError = Schema.is(TextGenerationError);

describe("KiloTextGeneration", () => {
  it("removes repeated quote and code-fence wrappers from branch names", () => {
    expect(sanitizeKiloBranchName("```feature/kilo-provider```")).toBe("feature/kilo-provider");
    expect(sanitizeKiloBranchName('""feature-name""')).toBe("feature-name");
  });
});

const runtimeMock = {
  state: {
    sessionResult: undefined as { data?: { id: string } } | undefined,
    promptResult: undefined as
      | { data?: { info?: { error?: unknown }; parts?: Array<unknown> } }
      | undefined,
    failSessionCreateWith: undefined as Error | undefined,
  },
  reset() {
    this.state.sessionResult = undefined;
    this.state.promptResult = undefined;
    this.state.failSessionCreateWith = undefined;
  },
};

const KiloRuntimeTestDouble: KiloRuntimeShape = {
  startServer: () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.void);
      return { url: "http://127.0.0.1:4301", external: false as const, exitCode: Effect.never };
    }),
  runCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createClient: () =>
    ({
      session: {
        create: async () => {
          if (runtimeMock.state.failSessionCreateWith) {
            throw runtimeMock.state.failSessionCreateWith;
          }
          return runtimeMock.state.sessionResult ?? { data: { id: "session-id" } };
        },
        prompt: async () => runtimeMock.state.promptResult ?? { data: { parts: [] } },
      },
    }) as unknown as ReturnType<KiloRuntimeShape["createClient"]>,
  loadInventory: () =>
    Effect.die(new KiloRuntimeError({ operation: "loadInventory", detail: "not used" })),
};

const TEST_SETTINGS = Schema.decodeSync(KiloSettings)({ binaryPath: "fake-kilo" });
const TEST_MODEL = createModelSelection(
  ProviderInstanceId.make("kilo"),
  "anthropic/claude-sonnet-4-5",
);

const kiloTextGenerationTestLayer = Layer.effect(
  TextGeneration.TextGeneration,
  makeKiloTextGeneration(TEST_SETTINGS),
).pipe(
  Layer.provideMerge(Layer.succeed(KiloRuntime, KiloRuntimeTestDouble)),
  Layer.provideMerge(ServerConfig.layerTest("/tmp/kilo-tg", "/tmp")),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(kiloTextGenerationTestLayer)("KiloTextGeneration error mapping", (it) => {
  beforeEach(() => {
    runtimeMock.reset();
  });

  it.effect(
    "maps KiloRuntimeError to a TextGenerationError with structural detail, not cause.message",
    () =>
      Effect.gen(function* () {
        runtimeMock.state.failSessionCreateWith = new KiloRuntimeError({
          operation: "session.create",
          detail: "credential material that must remain in the cause chain",
        });
        const tg = yield* TextGeneration.TextGeneration;
        const error = yield* tg
          .generateBranchName({
            cwd: "/tmp/kilo-tg",
            message: "noop",
            modelSelection: TEST_MODEL,
          })
          .pipe(Effect.flip);

        expect(isTextGenerationError(error)).toBe(true);
        if (!isTextGenerationError(error)) return;
        expect(error.operation).toBe("generateBranchName");
        expect(error.detail).toBe("Kilo text generation request failed (session.create).");
        // The wrapper's detail must NOT be derived from cause.message — this is
        // the Macroscope review's central complaint about the old Exit/Cause wrap.
        expect(error.detail.includes("credential material")).toBe(false);
        expect(error.cause !== undefined).toBe(true);
      }),
  );

  it.effect(
    "maps KiloTextGenerationSessionPayloadError to TextGenerationError with structural detail",
    () =>
      Effect.gen(function* () {
        runtimeMock.state.sessionResult = { data: undefined } as unknown as {
          data: { id: string };
        };
        const tg = yield* TextGeneration.TextGeneration;
        const error = yield* tg
          .generateBranchName({
            cwd: "/tmp/kilo-tg",
            message: "noop",
            modelSelection: TEST_MODEL,
          })
          .pipe(Effect.flip);

        expect(isTextGenerationError(error)).toBe(true);
        if (!isTextGenerationError(error)) return;
        expect(error.operation).toBe("generateBranchName");
        expect(error.detail).toBe("Kilo session.create returned no session payload.");
      }),
  );
});
