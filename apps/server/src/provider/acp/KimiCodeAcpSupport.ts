/**
 * KimiCodeAcpSupport — spawn and configuration helpers for Kimi Code CLI's
 * ACP stdio server (`kimi acp`).
 *
 * Kimi exposes a minimal ACP surface: auth method `"login"`, config options
 * for `model`, `thinking`, and `mode`, and modes `default`/`plan`/`auto`/`yolo`.
 *
 * @module provider/acp/KimiCodeAcpSupport
 */
import {
  type KimiCodeSettings,
  ProviderDriverKind,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

const KIMI_CODE_AUTH_METHOD_ID = "login";
const KIMI_CODE_DRIVER_KIND = ProviderDriverKind.make("kimiCode");
const KIMI_CODE_DEFAULT_MODEL = "kimi-code/kimi-for-coding";

const KIMI_CODE_MODE_ALIASES = {
  plan: ["plan"],
  implement: ["auto", "yolo", "default"],
  approval: ["default", "auto"],
} as const;

type KimiCodeAcpRuntimeKimiCodeSettings = Pick<KimiCodeSettings, "binaryPath">;

interface KimiCodeAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly kimiCodeSettings: KimiCodeAcpRuntimeKimiCodeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildKimiCodeAcpSpawnInput(
  kimiCodeSettings: KimiCodeAcpRuntimeKimiCodeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  return {
    command: kimiCodeSettings?.binaryPath || "kimi",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeKimiCodeAcpRuntime = (
  input: KimiCodeAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildKimiCodeAcpSpawnInput(input.kimiCodeSettings, input.cwd, input.environment),
        authMethodId: KIMI_CODE_AUTH_METHOD_ID,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

export function resolveKimiCodeAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : KIMI_CODE_DEFAULT_MODEL;
  return normalizeModelSlug(base, KIMI_CODE_DRIVER_KIND) ?? KIMI_CODE_DEFAULT_MODEL;
}

export function currentKimiCodeModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyKimiCodeAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntimeShape, "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

function findKimiCodeModeId(
  modes: ReadonlyArray<EffectAcpSchema.SessionMode> | null | undefined,
  aliases: ReadonlyArray<string>,
): string | undefined {
  if (!modes || modes.length === 0) {
    return undefined;
  }
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find((mode) => mode.id.toLowerCase() === alias);
    if (exact) {
      return exact.id;
    }
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => {
      const name = mode.name?.toLowerCase() ?? "";
      const description = mode.description?.toLowerCase() ?? "";
      return (
        mode.id.toLowerCase().includes(alias) || name.includes(alias) || description.includes(alias)
      );
    });
    if (partial) {
      return partial.id;
    }
  }
  return undefined;
}

export function resolveKimiCodeAcpModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode | undefined;
  readonly availableModes: ReadonlyArray<EffectAcpSchema.SessionMode> | null | undefined;
  readonly currentModeId: string | undefined;
}): string | undefined {
  if (input.interactionMode === "plan") {
    return (
      findKimiCodeModeId(input.availableModes, [...KIMI_CODE_MODE_ALIASES.plan]) ??
      input.currentModeId
    );
  }
  if (input.runtimeMode === "approval-required") {
    return (
      findKimiCodeModeId(input.availableModes, [...KIMI_CODE_MODE_ALIASES.approval]) ??
      findKimiCodeModeId(input.availableModes, [...KIMI_CODE_MODE_ALIASES.implement]) ??
      input.currentModeId
    );
  }
  return (
    findKimiCodeModeId(input.availableModes, [...KIMI_CODE_MODE_ALIASES.implement]) ??
    findKimiCodeModeId(input.availableModes, [...KIMI_CODE_MODE_ALIASES.approval]) ??
    input.currentModeId
  );
}
