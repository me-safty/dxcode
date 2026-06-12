import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyKimiCodeAcpModelSelection,
  buildKimiCodeAcpSpawnInput,
  resolveKimiCodeAcpBaseModelId,
  resolveKimiCodeAcpModeId,
} from "./KimiCodeAcpSupport.ts";

describe("resolveKimiCodeAcpBaseModelId", () => {
  it("normalizes empty and custom Kimi Code model ids", () => {
    expect(resolveKimiCodeAcpBaseModelId(undefined)).toBe("kimi-code/kimi-for-coding");
    expect(resolveKimiCodeAcpBaseModelId("   ")).toBe("kimi-code/kimi-for-coding");
    expect(resolveKimiCodeAcpBaseModelId("  kimi-code/custom  ")).toBe("kimi-code/custom");
  });
});

describe("buildKimiCodeAcpSpawnInput", () => {
  it("builds the spawn input for kimi acp", () => {
    const spawn = buildKimiCodeAcpSpawnInput(
      { binaryPath: "/usr/local/bin/kimi" },
      "/tmp/project",
      { CUSTOM_ENV: "value" },
    );

    expect(spawn).toEqual({
      command: "/usr/local/bin/kimi",
      args: ["acp"],
      cwd: "/tmp/project",
      env: { CUSTOM_ENV: "value" },
    });
  });

  it("falls back to 'kimi' when binary path is empty", () => {
    const spawn = buildKimiCodeAcpSpawnInput({ binaryPath: "" }, "/tmp/project");
    expect(spawn.command).toBe("kimi");
  });
});

describe("resolveKimiCodeAcpModeId", () => {
  const modes = [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
    { id: "auto", name: "Auto" },
    { id: "yolo", name: "YOLO" },
  ];

  it("selects plan mode for interactionMode plan", () => {
    expect(
      resolveKimiCodeAcpModeId({
        interactionMode: "plan",
        runtimeMode: "full-access",
        availableModes: modes,
        currentModeId: "default",
      }),
    ).toBe("plan");
  });

  it("selects yolo mode for full-access runtime", () => {
    expect(
      resolveKimiCodeAcpModeId({
        interactionMode: "default",
        runtimeMode: "full-access",
        availableModes: modes,
        currentModeId: "default",
      }),
    ).toBe("auto");
  });

  it("selects default mode for approval-required runtime", () => {
    expect(
      resolveKimiCodeAcpModeId({
        interactionMode: "default",
        runtimeMode: "approval-required",
        availableModes: modes,
        currentModeId: "auto",
      }),
    ).toBe("default");
  });

  it("falls back to current mode when no match is found", () => {
    expect(
      resolveKimiCodeAcpModeId({
        interactionMode: "default",
        runtimeMode: "full-access",
        availableModes: [{ id: "default", name: "Default" }],
        currentModeId: "default",
      }),
    ).toBe("default");
  });
});

describe("applyKimiCodeAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setSessionModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyKimiCodeAcpModelSelection({
        runtime,
        currentModelId: "kimi-code/kimi-for-coding",
        requestedModelId: "kimi-code/custom",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["kimi-code/custom"]);
      expect(result).toBe("kimi-code/custom");
    }),
  );

  it.effect("skips set_model when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyKimiCodeAcpModelSelection({
        runtime,
        currentModelId: "kimi-code/kimi-for-coding",
        requestedModelId: "kimi-code/kimi-for-coding",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("kimi-code/kimi-for-coding");
    }),
  );

  it.effect("skips set_model when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyKimiCodeAcpModelSelection({
        runtime,
        currentModelId: "kimi-code/kimi-for-coding",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("kimi-code/kimi-for-coding");
    }),
  );

  it.effect("propagates session/set_model failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyKimiCodeAcpModelSelection({
          runtime,
          currentModelId: "kimi-code/kimi-for-coding",
          requestedModelId: "kimi-code/custom",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});
