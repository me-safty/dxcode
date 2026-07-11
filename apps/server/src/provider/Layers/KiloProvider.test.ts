import { describe, expect, it } from "@effect/vitest";
import type { KiloSettings } from "@t3tools/contracts";
import type { ProviderListResponse } from "@kilocode/sdk/v2";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { KiloRuntime, KiloRuntimeError, type KiloRuntimeShape } from "../kiloRuntime.ts";
import { checkKiloProviderStatus, flattenKiloModels } from "./KiloProvider.ts";

const settings: KiloSettings = {
  enabled: true,
  binaryPath: "kilo",
  customModels: [],
};

const inventory: ProviderListResponse = {
  all: [
    {
      id: "anthropic",
      name: "Anthropic",
      source: "api",
      env: [],
      options: {},
      models: {
        sonnet: {
          id: "claude-sonnet",
          providerID: "anthropic",
          api: { id: "claude-sonnet", url: "https://example.test", npm: "@ai-sdk/anthropic" },
          name: "Claude Sonnet",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200_000, output: 16_000 },
          status: "active",
          options: {},
          headers: {},
          release_date: "2026-01-01",
        },
      },
    },
    {
      id: "disconnected",
      name: "Disconnected",
      source: "api",
      env: [],
      options: {},
      models: {},
    },
  ],
  default: {},
  connected: ["anthropic"],
  failed: [],
};

describe("KiloProvider", () => {
  it("flattens only connected upstream models into canonical provider/model slugs", () => {
    expect(flattenKiloModels(inventory)).toEqual([
      expect.objectContaining({
        slug: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        subProvider: "Anthropic",
      }),
    ]);
  });

  it.effect("reports dynamic inventory and version through the Kilo snapshot", () => {
    const runtime: KiloRuntimeShape = {
      runCommand: () => Effect.succeed({ stdout: "7.4.5\n", stderr: "", code: 0 }),
      startServer: () =>
        Effect.succeed({
          url: "http://127.0.0.1:4096",
          external: false,
          exitCode: Effect.succeed(0),
        }),
      createClient: () => ({}) as never,
      loadInventory: () => Effect.succeed(inventory),
    };
    return checkKiloProviderStatus(settings, process.cwd()).pipe(
      Effect.provide(Layer.succeed(KiloRuntime, runtime)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          expect(snapshot.installed).toBe(true);
          expect(snapshot.version).toBe("7.4.5");
          expect(snapshot.status).toBe("ready");
          expect(snapshot.models.map((model) => model.slug)).toEqual(["anthropic/claude-sonnet"]);
        }),
      ),
    );
  });

  it.effect("distinguishes a missing Kilo binary", () => {
    const runtime: KiloRuntimeShape = {
      runCommand: () =>
        Effect.fail(
          new KiloRuntimeError({
            operation: "runCommand",
            detail: "spawn kilo ENOENT",
          }),
        ),
      startServer: () =>
        Effect.fail(new KiloRuntimeError({ operation: "startServer", detail: "unused" })),
      createClient: () => ({}) as never,
      loadInventory: () => Effect.succeed(inventory),
    };
    return checkKiloProviderStatus(settings, process.cwd()).pipe(
      Effect.provide(Layer.succeed(KiloRuntime, runtime)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          expect(snapshot.installed).toBe(false);
          expect(snapshot.status).toBe("error");
          expect(snapshot.message).toContain("not installed");
        }),
      ),
    );
  });
});
