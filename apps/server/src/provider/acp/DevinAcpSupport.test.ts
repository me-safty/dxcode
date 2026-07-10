import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyDevinAcpModelSelection,
  buildDevinAcpSpawnInput,
  currentDevinModelIdFromSessionSetup,
  resolveDevinAcpBaseModelId,
} from "./DevinAcpSupport.ts";

describe("resolveDevinAcpBaseModelId", () => {
  it("normalizes empty and custom Devin model ids", () => {
    expect(resolveDevinAcpBaseModelId(undefined)).toBe("adaptive");
    expect(resolveDevinAcpBaseModelId("   ")).toBe("adaptive");
    expect(resolveDevinAcpBaseModelId("  claude-opus-4-8-high  ")).toBe("claude-opus-4-8-high");
  });
});

describe("buildDevinAcpSpawnInput", () => {
  it("spawns the Devin CLI with the acp subcommand", () => {
    const spawn = buildDevinAcpSpawnInput({ binaryPath: "/usr/local/bin/devin" }, "/tmp/project", {
      WINDSURF_API_KEY: "secret",
    });

    expect(spawn).toEqual({
      command: "/usr/local/bin/devin",
      args: ["acp"],
      cwd: "/tmp/project",
      env: {
        WINDSURF_API_KEY: "secret",
      },
    });
  });

  it("falls back to the devin binary name and omits env when not provided", () => {
    const spawn = buildDevinAcpSpawnInput(null, "/tmp/project");

    expect(spawn).toEqual({
      command: "devin",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });
});

describe("currentDevinModelIdFromSessionSetup", () => {
  it("reads the current model from the model config option", () => {
    const sessionSetup = {
      sessionId: "mock-session-1",
      configOptions: [
        {
          id: "mode",
          name: "Session Mode",
          category: "mode",
          type: "select",
          currentValue: "accept-edits",
          options: [{ value: "accept-edits", name: "Code" }],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "  adaptive  ",
          options: [{ value: "adaptive", name: "Adaptive" }],
        },
      ],
    } satisfies EffectAcpSchema.NewSessionResponse;

    expect(currentDevinModelIdFromSessionSetup(sessionSetup)).toBe("adaptive");
  });

  it("returns undefined when no model config option is present", () => {
    expect(
      currentDevinModelIdFromSessionSetup({
        sessionId: "mock-session-1",
      } satisfies EffectAcpSchema.NewSessionResponse),
    ).toBeUndefined();
  });
});

describe("applyDevinAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("sets the model config option when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyDevinAcpModelSelection({
        runtime,
        currentModelId: "adaptive",
        requestedModelId: "claude-opus-4-8-high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["claude-opus-4-8-high"]);
      expect(result).toBe("claude-opus-4-8-high");
    }),
  );

  it.effect("skips the config option write when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyDevinAcpModelSelection({
        runtime,
        currentModelId: "adaptive",
        requestedModelId: "adaptive",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("adaptive");
    }),
  );

  it.effect("skips the config option write when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyDevinAcpModelSelection({
        runtime,
        currentModelId: "adaptive",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("adaptive");
    }),
  );

  it.effect("propagates session/set_config_option failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyDevinAcpModelSelection({
          runtime,
          currentModelId: "adaptive",
          requestedModelId: "claude-opus-4-8-high",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});
