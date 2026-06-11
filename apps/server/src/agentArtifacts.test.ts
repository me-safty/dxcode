// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  AGENT_ARTIFACTS_MANIFEST_FILE,
  agentArtifactsDirForThread,
  materializeAgentArtifactManifest,
} from "./agentArtifacts.ts";
import { attachmentRelativePath } from "./attachmentStore.ts";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config.ts";

function makeConfig(baseDir: string): Effect.Effect<ServerConfigShape, never, never> {
  return deriveServerPaths(baseDir, undefined).pipe(
    Effect.map(
      (derivedPaths) =>
        ({
          logLevel: "Info",
          traceMinLevel: "Info",
          traceTimingEnabled: true,
          traceBatchWindowMs: 200,
          traceMaxBytes: 10 * 1024 * 1024,
          traceMaxFiles: 10,
          otlpTracesUrl: undefined,
          otlpMetricsUrl: undefined,
          otlpExportIntervalMs: 10_000,
          otlpServiceName: "t3-server",
          mode: "desktop",
          port: 0,
          host: "127.0.0.1",
          cwd: process.cwd(),
          baseDir,
          ...derivedPaths,
          staticDir: undefined,
          devUrl: undefined,
          noBrowser: true,
          startupPresentation: "browser",
          desktopBootstrapToken: undefined,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
        }) satisfies ServerConfigShape,
    ),
    Effect.provide(NodeServices.layer),
  );
}

describe("agentArtifacts", () => {
  it.effect("materializes declared generated files into persisted chat attachments", () =>
    Effect.gen(function* () {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-agent-artifacts-"));
      try {
        const config = yield* makeConfig(baseDir);
        const threadId = ThreadId.make("thread-artifacts");
        const artifactsDir = agentArtifactsDirForThread({
          stateDir: config.stateDir,
          threadId,
        });
        fs.mkdirSync(path.join(artifactsDir, "exports"), { recursive: true });
        fs.writeFileSync(path.join(artifactsDir, "exports", "report.csv"), "name,value\nA,1\n");
        fs.writeFileSync(
          path.join(artifactsDir, AGENT_ARTIFACTS_MANIFEST_FILE),
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.stringify({
            attachments: [
              {
                path: "exports/report.csv",
                name: "report.csv",
                mimeType: "text/csv",
              },
            ],
          }),
        );

        const attachments = yield* materializeAgentArtifactManifest({ threadId }).pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(ServerConfig, config),
        );

        expect(attachments).toHaveLength(1);
        const attachment = attachments[0];
        expect(attachment).toMatchObject({
          type: "file",
          name: "report.csv",
          mimeType: "text/csv",
          sizeBytes: 15,
        });
        if (!attachment) {
          return;
        }
        expect(
          fs.existsSync(path.join(config.attachmentsDir, attachmentRelativePath(attachment))),
        ).toBe(true);
        expect(fs.existsSync(path.join(artifactsDir, AGENT_ARTIFACTS_MANIFEST_FILE))).toBe(false);
      } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    }),
  );
});
