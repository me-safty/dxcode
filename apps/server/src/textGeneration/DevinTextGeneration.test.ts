// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { DevinSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { makeDevinTextGeneration } from "./DevinTextGeneration.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../scripts/acp-mock-agent.ts");

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function makeAcpDevinWrapper(dir: string, env: Record<string, string>): string {
  const binDir = NodePath.join(dir, "bin");
  const devinPath = NodePath.join(binDir, "devin");
  NodeFS.mkdirSync(binDir, { recursive: true });
  NodeFS.writeFileSync(
    devinPath,
    [
      "#!/bin/sh",
      ...Object.entries(env).map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`),
      'if [ "$1" != "acp" ]; then',
      '  printf "%s\\n" "unexpected args: $*" >&2',
      "  exit 11",
      "fi",
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(devinPath, 0o755);
  return devinPath;
}

const DevinTextGenerationTestLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-devin-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(DevinTextGenerationTestLayer)("DevinTextGeneration", (it) => {
  it.effect("ignores message chunks from foreign sessions", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-devin-text-acp-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      );
      const binaryPath = makeAcpDevinWrapper(tempDir, {
        T3_ACP_PROMPT_RESPONSE_TEXT: '{"title":"Root title"}',
        T3_ACP_FOREIGN_SESSION_RESPONSE_TEXT: '{"title":"Child title"}',
      });
      const textGeneration = yield* makeDevinTextGeneration(decodeDevinSettings({ binaryPath }));

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "title the root session",
        modelSelection: createModelSelection(ProviderInstanceId.make("devin"), "composer-2"),
      });

      expect(generated.title).toBe("Root title");
    }).pipe(Effect.scoped),
  );

  it.effect("reports cancellation even when the agent emitted valid partial output", () =>
    Effect.gen(function* () {
      const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-devin-text-acp-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      );
      const binaryPath = makeAcpDevinWrapper(tempDir, {
        T3_ACP_PROMPT_RESPONSE_TEXT: '{"title":"Incomplete title"}',
        T3_ACP_CANCEL_PROMPT_AFTER_RESPONSE: "1",
      });
      const textGeneration = yield* makeDevinTextGeneration(decodeDevinSettings({ binaryPath }));

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "cancel this request",
          modelSelection: createModelSelection(ProviderInstanceId.make("devin"), "composer-2"),
        }),
      );

      expect(error._tag).toBe("TextGenerationError");
      expect(error.detail).toMatch(/cancelled/i);
    }).pipe(Effect.scoped),
  );
});
